//! # database_adapter
//!
//! Async PostgreSQL storage adapter for the Midwater industrial reasoning
//! stack. Responsibilities:
//!
//! * Archive per-step **fractional drift coefficients** (`alpha`, memory-term
//!   weights, residual norms) computed by the `rftl_continuous` crate.
//! * Archive **high-dimensional polynomial coordinates** representing the
//!   trailing state of the simulation in a compact coefficient basis.
//! * Route anomalous rows — detected server-side by an expression index +
//!   trigger — into an isolated `system_alerts` queue for downstream
//!   consumption by the ML refinement worker.
//!
//! The adapter is `#![forbid(unsafe_code)]`, uses `deadpool-postgres` for
//! connection pooling, and executes every write inside a prepared statement
//! so the server-side plan cache can absorb the 15,000 writes/sec target.
//!
//! ## Schema
//!
//! See `migrations.sql` in this directory for the exact DDL. The two hot
//! tables are declaratively range-partitioned by `recorded_at` (monthly).

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

use chrono::{DateTime, Utc};
use deadpool_postgres::{Config as PoolConfig, Pool, Runtime};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tokio_postgres::{types::ToSql, NoTls};
use uuid::Uuid;

// ─── Errors ──────────────────────────────────────────────────────────────────

/// Errors surfaced by the storage adapter.
#[derive(Debug, Error)]
pub enum StorageError {
    /// A wrapped `tokio-postgres` error.
    #[error("postgres error: {0}")]
    Postgres(#[from] tokio_postgres::Error),

    /// Pool initialisation or checkout error.
    #[error("pool error: {0}")]
    Pool(String),

    /// The caller supplied an invalid payload.
    #[error("invalid payload: {0}")]
    InvalidPayload(&'static str),
}

impl From<deadpool_postgres::PoolError> for StorageError {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        StorageError::Pool(e.to_string())
    }
}

impl From<deadpool_postgres::CreatePoolError> for StorageError {
    fn from(e: deadpool_postgres::CreatePoolError) -> Self {
        StorageError::Pool(e.to_string())
    }
}

// ─── Records ─────────────────────────────────────────────────────────────────

/// A single archived record of fractional drift coefficients emitted after
/// each solver step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftCoefficientRecord {
    /// Simulation run identifier.
    pub run_id: Uuid,
    /// Monotonic solver step index.
    pub step_index: i64,
    /// Wall-clock instant the coefficients were recorded.
    pub recorded_at: DateTime<Utc>,
    /// Caputo fractional order (0, 1].
    pub alpha: f64,
    /// Memory-term weights `b_k` (length = history window).
    pub memory_weights: Vec<f64>,
    /// L2 norm of the state residual at this step.
    pub residual_norm: f64,
    /// Free-form metadata (grid shape, material tag, tenant, ...).
    pub metadata: serde_json::Value,
}

/// A high-dimensional polynomial-coordinate record of the trailing state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolynomialCoordRecord {
    /// Simulation run identifier.
    pub run_id: Uuid,
    /// Monotonic solver step index.
    pub step_index: i64,
    /// Wall-clock instant the coordinates were recorded.
    pub recorded_at: DateTime<Utc>,
    /// Basis identifier — e.g. `"chebyshev-3d-deg8"`.
    pub basis: String,
    /// Flat coefficient vector.
    pub coefficients: Vec<f64>,
    /// Trailing tail coefficients used for anomaly detection.
    pub trailing_coefficients: Vec<f64>,
}

impl PolynomialCoordRecord {
    /// L2 (geometric) norm of the trailing coefficients — kept in Rust for
    /// client-side pre-filtering but ultimately re-computed inside the DB
    /// trigger so the source of truth is server-side.
    pub fn trailing_norm(&self) -> f64 {
        self.trailing_coefficients.iter().map(|c| c * c).sum::<f64>().sqrt()
    }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/// Async connection-pooled Postgres storage adapter.
#[derive(Clone)]
pub struct StorageAdapter {
    pool: Pool,
}

impl StorageAdapter {
    /// Build a pool from a DSN. The pool is sized for high write throughput
    /// (default 32 connections, 5s statement timeout).
    pub async fn connect(dsn: &str, max_size: usize) -> Result<Self, StorageError> {
        let mut cfg = PoolConfig::new();
        cfg.url = Some(dsn.to_string());
        cfg.pool = Some(deadpool_postgres::PoolConfig::new(max_size));
        cfg.connect_timeout = Some(Duration::from_secs(5));
        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

        // Cheap liveness probe.
        let client = pool.get().await?;
        let _ = client.simple_query("SELECT 1").await?;

        Ok(Self { pool })
    }

    /// Insert a batch of drift-coefficient rows in a single transaction.
    /// Uses a multi-row `INSERT` prepared statement so the server-side plan
    /// cache amortises across the 15k rps hot path.
    pub async fn insert_drift_batch(
        &self,
        records: &[DriftCoefficientRecord],
    ) -> Result<u64, StorageError> {
        if records.is_empty() {
            return Ok(0);
        }
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;

        let stmt = tx
            .prepare_cached(
                "INSERT INTO fractional_drift_coefficients \
                 (run_id, step_index, recorded_at, alpha, memory_weights, residual_norm, metadata) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .await?;

        let mut inserted = 0u64;
        for r in records {
            let params: [&(dyn ToSql + Sync); 7] = [
                &r.run_id,
                &r.step_index,
                &r.recorded_at,
                &r.alpha,
                &r.memory_weights,
                &r.residual_norm,
                &r.metadata,
            ];
            inserted += tx.execute(&stmt, &params).await?;
        }

        tx.commit().await?;
        Ok(inserted)
    }

    /// Insert a batch of polynomial-coordinate rows. The `trailing_norm`
    /// index + trigger installed by `migrations.sql` will push any row whose
    /// trailing-coefficient L2 norm exceeds the configured threshold into
    /// `system_alerts` automatically — no client-side branching required.
    pub async fn insert_poly_batch(
        &self,
        records: &[PolynomialCoordRecord],
    ) -> Result<u64, StorageError> {
        if records.is_empty() {
            return Ok(0);
        }
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;

        let stmt = tx
            .prepare_cached(
                "INSERT INTO polynomial_coordinates \
                 (run_id, step_index, recorded_at, basis, coefficients, trailing_coefficients) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .await?;

        let mut inserted = 0u64;
        for r in records {
            if r.trailing_coefficients.is_empty() {
                return Err(StorageError::InvalidPayload(
                    "trailing_coefficients must not be empty",
                ));
            }
            let params: [&(dyn ToSql + Sync); 6] = [
                &r.run_id,
                &r.step_index,
                &r.recorded_at,
                &r.basis,
                &r.coefficients,
                &r.trailing_coefficients,
            ];
            inserted += tx.execute(&stmt, &params).await?;
        }

        tx.commit().await?;
        Ok(inserted)
    }

    /// Fetch the newest un-acknowledged alerts, up to `limit` rows.
    pub async fn fetch_alerts(&self, limit: i64) -> Result<Vec<AlertRow>, StorageError> {
        let client = self.pool.get().await?;
        let rows = client
            .query(
                "SELECT alert_id, run_id, step_index, recorded_at, trailing_norm, severity, payload \
                 FROM system_alerts \
                 WHERE acknowledged_at IS NULL \
                 ORDER BY recorded_at DESC \
                 LIMIT $1",
                &[&limit],
            )
            .await?;

        Ok(rows
            .into_iter()
            .map(|r| AlertRow {
                alert_id: r.get(0),
                run_id: r.get(1),
                step_index: r.get(2),
                recorded_at: r.get(3),
                trailing_norm: r.get(4),
                severity: r.get(5),
                payload: r.get(6),
            })
            .collect())
    }

    /// Acknowledge a set of alerts so the refinement worker will not pick
    /// them up on the next poll.
    pub async fn acknowledge_alerts(&self, ids: &[Uuid]) -> Result<u64, StorageError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let client = self.pool.get().await?;
        let n = client
            .execute(
                "UPDATE system_alerts SET acknowledged_at = now() \
                 WHERE alert_id = ANY($1) AND acknowledged_at IS NULL",
                &[&ids],
            )
            .await?;
        Ok(n)
    }
}

/// A single row of the `system_alerts` queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRow {
    /// Alert primary key.
    pub alert_id: Uuid,
    /// Originating simulation run id.
    pub run_id: Uuid,
    /// Step index at which the anomaly was flagged.
    pub step_index: i64,
    /// Timestamp inherited from the source row.
    pub recorded_at: DateTime<Utc>,
    /// L2 norm of trailing coefficients that triggered the alert.
    pub trailing_norm: f64,
    /// Severity label (`"warning"` | `"critical"`), assigned by the trigger.
    pub severity: String,
    /// JSON payload with additional context — populated by the trigger.
    pub payload: serde_json::Value,
}
