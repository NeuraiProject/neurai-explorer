use sqlx::PgPool;
use tracing::{info, warn};

use crate::error::{Result, SyncerError};

/// Layout of the indexed data written by this syncer. Bumped whenever rows
/// written by an older version cannot be completed in place.
pub const SCHEMA_VERSION: &str = "4";

const RESYNC_ENV: &str = "RESYNC_ON_SCHEMA_CHANGE";

/// Tables holding data derived from the chain. `network_stats` and the rest
/// of `sync_state` are kept.
const DATA_TABLES: &[&str] = &[
    "tx_address_assets",
    "tx_addresses",
    "address_assets",
    "transactions",
    "blocks",
    "addresses",
    "assets",
    "mempool",
    "daily_stats",
];

/// Refuse to mix data written with an older layout with the current one.
///
/// A fresh database is stamped with the current version. A populated one
/// with a different (or missing) version stops the syncer, unless
/// `RESYNC_ON_SCHEMA_CHANGE=1` is set, in which case the indexed data is
/// wiped and synced again from genesis.
pub async fn ensure_schema_version(pool: &PgPool) -> Result<()> {
    let stored: Option<(Option<String>,)> =
        sqlx::query_as("SELECT value FROM sync_state WHERE key = 'schema_version'")
            .fetch_optional(pool)
            .await?;
    let stored = stored.and_then(|(v,)| v);
    let resync = std::env::var(RESYNC_ENV)
        .map(|v| matches!(v.trim(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);

    if stored.as_deref() == Some(SCHEMA_VERSION) {
        if resync {
            warn!(
                "{}=1 is set but the schema is already at version {}; unset it so a \
                 future upgrade does not wipe the data without you noticing",
                RESYNC_ENV, SCHEMA_VERSION
            );
        }
        return Ok(());
    }

    let (has_data,): (bool,) = sqlx::query_as("SELECT EXISTS (SELECT 1 FROM blocks)")
        .fetch_one(pool)
        .await?;

    if !has_data {
        set_version(pool).await?;
        return Ok(());
    }

    if !resync {
        return Err(SyncerError::Config(format!(
            "The database holds data written with schema version {} but this syncer \
             writes version {}. Start the syncer once with {}=1 to wipe the indexed \
             data and sync again from genesis (network_stats is kept).",
            stored.as_deref().unwrap_or("3 or older"),
            SCHEMA_VERSION,
            RESYNC_ENV
        )));
    }

    warn!(
        from = stored.as_deref().unwrap_or("3 or older"),
        to = SCHEMA_VERSION,
        "Schema version changed: wiping indexed data and resyncing from genesis"
    );

    let mut tx = pool.begin().await?;
    sqlx::query(&format!("TRUNCATE {} CASCADE", DATA_TABLES.join(", ")))
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sync_state WHERE key = 'last_height'")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO sync_state (key, value) VALUES ('schema_version', $1) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(SCHEMA_VERSION)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    info!("Indexed data wiped");
    Ok(())
}

async fn set_version(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "INSERT INTO sync_state (key, value) VALUES ('schema_version', $1) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;
    Ok(())
}
