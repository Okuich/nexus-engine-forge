-- ============================================================================
-- Midwater industrial reasoning stack — PostgreSQL schema
--
-- Two hot tables (`fractional_drift_coefficients`, `polynomial_coordinates`)
-- are declaratively RANGE-partitioned on `recorded_at` (monthly). This scales
-- linearly to the 15,000 writes/sec target because:
--
--   * Each partition is a physically separate table with its own local
--     indexes, WAL contention footprint, and vacuum schedule.
--   * The primary INSERT hot-spot moves to a fresh partition every month,
--     bounding B-tree fanout depth and keeping the hot pages in shared
--     buffers.
--   * Old partitions can be DETACH-ed and archived without a global lock.
--
-- An expression-based index over the L2 norm of `trailing_coefficients`,
-- paired with a `BEFORE INSERT` trigger, evaluates every incoming row's
-- geometric deviation and pipes anomalous ones to the isolated
-- `system_alerts` queue.
-- ============================================================================

BEGIN;

-- ─── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gin";     -- helpful for jsonb + btree

-- ─── Schemas ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rftl;

SET search_path = rftl, public;

-- ============================================================================
-- 1. FRACTIONAL DRIFT COEFFICIENTS  (partitioned by recorded_at)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fractional_drift_coefficients (
    coefficient_id  uuid        NOT NULL DEFAULT gen_random_uuid(),
    run_id          uuid        NOT NULL,
    step_index      bigint      NOT NULL,
    recorded_at     timestamptz NOT NULL,
    alpha           double precision NOT NULL,
    memory_weights  double precision[] NOT NULL,
    residual_norm   double precision NOT NULL,
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (coefficient_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Bootstrap partitions — one for the current month and one for the next.
-- In production a scheduled job (pg_partman or a cron worker) creates
-- rolling monthly partitions.
CREATE TABLE IF NOT EXISTS fractional_drift_coefficients_p_current
    PARTITION OF fractional_drift_coefficients
    FOR VALUES FROM (date_trunc('month', now()))
              TO   (date_trunc('month', now()) + INTERVAL '1 month');

CREATE TABLE IF NOT EXISTS fractional_drift_coefficients_p_next
    PARTITION OF fractional_drift_coefficients
    FOR VALUES FROM (date_trunc('month', now()) + INTERVAL '1 month')
              TO   (date_trunc('month', now()) + INTERVAL '2 months');

CREATE INDEX IF NOT EXISTS idx_drift_run_step
    ON fractional_drift_coefficients (run_id, step_index DESC);

-- ============================================================================
-- 2. POLYNOMIAL COORDINATES  (partitioned by recorded_at)
-- ============================================================================

CREATE TABLE IF NOT EXISTS polynomial_coordinates (
    coord_id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    run_id                  uuid        NOT NULL,
    step_index              bigint      NOT NULL,
    recorded_at             timestamptz NOT NULL,
    basis                   text        NOT NULL,
    coefficients            double precision[] NOT NULL,
    trailing_coefficients   double precision[] NOT NULL,
    PRIMARY KEY (coord_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS polynomial_coordinates_p_current
    PARTITION OF polynomial_coordinates
    FOR VALUES FROM (date_trunc('month', now()))
              TO   (date_trunc('month', now()) + INTERVAL '1 month');

CREATE TABLE IF NOT EXISTS polynomial_coordinates_p_next
    PARTITION OF polynomial_coordinates
    FOR VALUES FROM (date_trunc('month', now()) + INTERVAL '1 month')
              TO   (date_trunc('month', now()) + INTERVAL '2 months');

-- ─── Immutable helper: L2 norm of a double precision[] ──────────────────────
CREATE OR REPLACE FUNCTION rftl.trailing_l2_norm(coeffs double precision[])
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT sqrt(coalesce(sum(c * c), 0.0))
      FROM unnest(coeffs) AS c;
$$;

-- Expression-based index so the anomaly threshold check is a cheap index
-- scan even under 15k rps mixed reads / writes.
CREATE INDEX IF NOT EXISTS idx_polycoord_trailing_norm
    ON polynomial_coordinates ((rftl.trailing_l2_norm(trailing_coefficients)));

CREATE INDEX IF NOT EXISTS idx_polycoord_run_step
    ON polynomial_coordinates (run_id, step_index DESC);

-- ============================================================================
-- 3. SYSTEM ALERTS  (isolated queue — NOT partitioned; low cardinality)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_alerts (
    alert_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid        NOT NULL,
    source_coord_id uuid        NOT NULL,
    step_index      bigint      NOT NULL,
    recorded_at     timestamptz NOT NULL,
    trailing_norm   double precision NOT NULL,
    severity        text        NOT NULL CHECK (severity IN ('warning', 'critical')),
    payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alerts_unack
    ON system_alerts (recorded_at DESC)
    WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_run
    ON system_alerts (run_id, step_index DESC);

-- ============================================================================
-- 4. Configuration table for anomaly thresholds
-- ============================================================================

CREATE TABLE IF NOT EXISTS anomaly_thresholds (
    threshold_key   text PRIMARY KEY,
    warning_value   double precision NOT NULL,
    critical_value  double precision NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO anomaly_thresholds (threshold_key, warning_value, critical_value)
VALUES ('polynomial_trailing_norm', 1.0e-2, 1.0e-1)
ON CONFLICT (threshold_key) DO NOTHING;

-- ============================================================================
-- 5. Trigger — evaluate geometric norm of trailing coefficients on INSERT
--    and pipe anomalies to system_alerts.
-- ============================================================================

CREATE OR REPLACE FUNCTION rftl.route_polycoord_anomaly()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_norm      double precision;
    v_warn      double precision;
    v_crit      double precision;
    v_severity  text;
BEGIN
    v_norm := rftl.trailing_l2_norm(NEW.trailing_coefficients);

    SELECT warning_value, critical_value
      INTO v_warn, v_crit
      FROM rftl.anomaly_thresholds
     WHERE threshold_key = 'polynomial_trailing_norm';

    IF v_norm >= v_crit THEN
        v_severity := 'critical';
    ELSIF v_norm >= v_warn THEN
        v_severity := 'warning';
    ELSE
        RETURN NEW;   -- inside tolerance, no alert
    END IF;

    INSERT INTO rftl.system_alerts (
        run_id, source_coord_id, step_index, recorded_at,
        trailing_norm, severity, payload
    )
    VALUES (
        NEW.run_id,
        NEW.coord_id,
        NEW.step_index,
        NEW.recorded_at,
        v_norm,
        v_severity,
        jsonb_build_object(
            'basis',                NEW.basis,
            'trailing_length',      cardinality(NEW.trailing_coefficients),
            'warning_threshold',    v_warn,
            'critical_threshold',   v_crit
        )
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_polycoord_anomaly ON polynomial_coordinates;
CREATE TRIGGER trg_polycoord_anomaly
    BEFORE INSERT ON polynomial_coordinates
    FOR EACH ROW
    EXECUTE FUNCTION rftl.route_polycoord_anomaly();

COMMIT;
