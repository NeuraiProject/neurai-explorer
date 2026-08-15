use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::ConnectOptions;
use std::str::FromStr;
use std::time::Duration;

use crate::config::DatabaseConfig;
use crate::error::Result;

pub async fn create_pool(config: &DatabaseConfig) -> Result<PgPool> {
    // Batch inserts of a few thousand rows legitimately take more than the
    // 1 s sqlx uses to flag "slow statements" on a busy disk; keep those at
    // debug instead of flooding the log with warnings during the initial sync.
    let options = PgConnectOptions::from_str(&config.connection_string())?
        .log_slow_statements(log::LevelFilter::Debug, Duration::from_secs(1));

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect_with(options)
        .await?;

    tracing::info!("Database connection pool created");

    // Run database migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| crate::error::SyncerError::Database(e.into()))?;

    tracing::info!("Database migrations applied successfully");

    super::schema::ensure_schema_version(&pool).await?;

    Ok(pool)
}
