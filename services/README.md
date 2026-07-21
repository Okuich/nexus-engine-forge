# Midwater Industrial Reasoning Stack

Three production-grade modules, delivered together:

| # | Module | Language | Path |
|---|--------|----------|------|
| 1 | High-performance continuous simulation core | Rust | `rftl_continuous/` |
| 2 | Storage adapter + PostgreSQL migrations   | Rust + SQL | `database/` |
| 3 | Closed-loop ML refinement worker           | Python | `refinement/` |

These live alongside the Midwater web app but are not built by the frontend
Vite pipeline. Build/run them with their native toolchains:

```bash
# 1. Continuous simulation core
cd services/rftl_continuous && cargo build --release && cargo test

# 2. Storage adapter (apply migrations first)
psql "$MIDWATER_DB_DSN" -f services/database/migrations.sql
cd services/database && cargo build --release

# 3. Refinement worker
cd services/refinement
pip install "numpy>=1.26" "scikit-learn>=1.4" "psycopg[binary]>=3.1" "pydantic>=2"
MIDWATER_DB_DSN="postgres://..." python refinement_loop.py
```

## Data flow

```
rftl_continuous  ──▶  database_adapter  ──▶  Postgres (partitioned)
                                                │
                                                ▼
                                       BEFORE INSERT trigger
                                                │
                                                ▼
                                       rftl.system_alerts
                                                │
                                                ▼
                                       refinement_loop.py
                                                │
                                                ▼
                                Pre-deformed CAD boundary coords
```

Each stage is independently testable and horizontally scalable.
