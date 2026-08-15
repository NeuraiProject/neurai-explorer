//! "Bulk mode" for the initial sync.
//!
//! While the syncer is far behind the tip it drops the secondary indexes
//! whose keys are random (txid/address/balance ordered) and pauses autovacuum
//! on the big tables; both are pure overhead while millions of rows are being
//! appended and nobody queries them yet. When it gets close to the tip it
//! rebuilds the indexes in one go (much cheaper than maintaining them
//! insert by insert), re-enables autovacuum and analyzes the tables.
//!
//! What was dropped is recorded in `sync_state` (`bulk_mode`), definitions
//! included, in the same transaction as the DROP, so a restart at any point
//! resumes correctly and always recreates exactly what the migrations built.
//! Primary keys and the indexes on monotonically increasing keys
//! (`time`, `block_height`) are kept: the former are used by the writer's
//! `ON CONFLICT`, the latter are almost free to maintain and keep rollbacks
//! and the daily aggregation fast.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Instant;
use tracing::{info, warn};

use crate::error::{Result, SyncerError};

pub const STATE_KEY: &str = "bulk_mode";

/// Secondary indexes with random keys, by name as created by the migrations.
/// A name that does not exist is skipped (already dropped or older schema).
const DEFERRABLE_INDEXES: &[&str] = &[
    "idx_txaddr_address_time",
    "idx_txaa_address_height",
    "idx_txaa_asset_height",
    "idx_asset_events_name",
    "idx_addr_balance",
    "idx_addr_asset_bal",
];

/// Tables whose insert-driven autovacuum is paused during bulk mode.
const AUTOVACUUM_TABLES: &[&str] = &[
    "blocks",
    "transactions",
    "tx_addresses",
    "tx_address_assets",
    "asset_events",
    "addresses",
    "address_assets",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DroppedIndex {
    pub name: String,
    /// `CREATE INDEX ...` statement as reported by `pg_indexes.indexdef`.
    pub def: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct BulkState {
    /// Indexes still to be recreated.
    pub indexes: Vec<DroppedIndex>,
    /// Tables with autovacuum disabled.
    pub tables: Vec<String>,
}

/// Current bulk state, `None` when not in bulk mode.
pub async fn state(pool: &PgPool) -> Result<Option<BulkState>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT value FROM sync_state WHERE key = $1")
            .bind(STATE_KEY)
            .fetch_optional(pool)
            .await?;
    match row.and_then(|(v,)| v) {
        Some(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| SyncerError::Sync(format!("corrupt {} state: {}", STATE_KEY, e))),
        None => Ok(None),
    }
}

/// Enter bulk mode: drop the deferrable indexes and pause autovacuum, all in
/// one transaction together with the state record.
pub async fn enter(pool: &PgPool) -> Result<BulkState> {
    let started = Instant::now();
    let mut tx = pool.begin().await?;

    let names: Vec<String> = DEFERRABLE_INDEXES.iter().map(|s| s.to_string()).collect();
    let existing: Vec<(String, String)> = sqlx::query_as(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
    )
    .bind(&names)
    .fetch_all(&mut *tx)
    .await?;

    let mut state = BulkState::default();
    for (name, def) in existing {
        sqlx::query(&format!("DROP INDEX IF EXISTS {}", quote_ident(&name)))
            .execute(&mut *tx)
            .await?;
        state.indexes.push(DroppedIndex { name, def });
    }

    for table in AUTOVACUUM_TABLES {
        if set_autovacuum(&mut tx, table, false).await? {
            state.tables.push(table.to_string());
        }
    }

    let json = serde_json::to_string(&state)?;
    sqlx::query(
        "INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(STATE_KEY)
    .bind(&json)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    info!(
        indexes_dropped = state.indexes.len(),
        autovacuum_paused = state.tables.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "Bulk mode ON: secondary indexes deferred until the sync is close to the tip"
    );
    Ok(state)
}

/// Leave bulk mode: rebuild every deferred index (one transaction each, the
/// state record is updated as they complete, so a crash midway resumes),
/// re-enable autovacuum and analyze the tables. Idempotent.
pub async fn exit(pool: &PgPool, index_build_mem: &str) -> Result<()> {
    let Some(mut state) = state(pool).await? else {
        return Ok(());
    };
    let started = Instant::now();
    info!(
        indexes = state.indexes.len(),
        "Bulk mode OFF: rebuilding secondary indexes"
    );

    while let Some(index) = state.indexes.first().cloned() {
        let t = Instant::now();
        let mut tx = pool.begin().await?;
        // Session-local: only for this build.
        sqlx::query(&format!("SET LOCAL maintenance_work_mem = '{}'", index_build_mem.replace('\'', "")))
            .execute(&mut *tx)
            .await?;
        sqlx::query(&idempotent_create(&index.def))
            .execute(&mut *tx)
            .await?;
        state.indexes.remove(0);
        sqlx::query("UPDATE sync_state SET value = $2 WHERE key = $1")
            .bind(STATE_KEY)
            .bind(serde_json::to_string(&state)?)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        info!(index = %index.name, elapsed_s = t.elapsed().as_secs_f64().round(), "Index rebuilt");
    }

    for table in state.tables.clone() {
        let mut tx = pool.begin().await?;
        set_autovacuum(&mut tx, &table, true).await?;
        tx.commit().await?;
        let t = Instant::now();
        sqlx::query(&format!("ANALYZE {}", quote_ident(&table)))
            .execute(pool)
            .await?;
        info!(table = %table, elapsed_s = t.elapsed().as_secs_f64().round(), "Autovacuum re-enabled and table analyzed");
    }

    sqlx::query("DELETE FROM sync_state WHERE key = $1")
        .bind(STATE_KEY)
        .execute(pool)
        .await?;

    info!(elapsed_s = started.elapsed().as_secs_f64().round(), "Bulk mode left");
    Ok(())
}

/// `ALTER TABLE ... SET/RESET (autovacuum_enabled[, toast.autovacuum_enabled])`.
/// Returns false if the table does not exist.
async fn set_autovacuum(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    table: &str,
    enabled: bool,
) -> Result<bool> {
    let info: Option<(bool,)> = sqlx::query_as(
        "SELECT reltoastrelid <> 0 FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace AND relkind = 'r'",
    )
    .bind(table)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((has_toast,)) = info else {
        warn!(table, "Table not found while toggling autovacuum");
        return Ok(false);
    };

    let sql = match (enabled, has_toast) {
        (false, true) => format!(
            "ALTER TABLE {} SET (autovacuum_enabled = false, toast.autovacuum_enabled = false)",
            quote_ident(table)
        ),
        (false, false) => format!("ALTER TABLE {} SET (autovacuum_enabled = false)", quote_ident(table)),
        (true, true) => format!(
            "ALTER TABLE {} RESET (autovacuum_enabled, toast.autovacuum_enabled)",
            quote_ident(table)
        ),
        (true, false) => format!("ALTER TABLE {} RESET (autovacuum_enabled)", quote_ident(table)),
    };
    sqlx::query(&sql).execute(&mut **tx).await?;
    Ok(true)
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// `pg_indexes.indexdef` starts with `CREATE [UNIQUE] INDEX name ON ...`;
/// make it safe to re-run.
fn idempotent_create(def: &str) -> String {
    if def.starts_with("CREATE UNIQUE INDEX ") {
        def.replacen("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", 1)
    } else if def.starts_with("CREATE INDEX ") {
        def.replacen("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1)
    } else {
        def.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_statements_become_idempotent() {
        assert_eq!(
            idempotent_create("CREATE INDEX idx_a ON public.t USING btree (a)"),
            "CREATE INDEX IF NOT EXISTS idx_a ON public.t USING btree (a)"
        );
        assert_eq!(
            idempotent_create("CREATE UNIQUE INDEX u ON public.t USING btree (a)"),
            "CREATE UNIQUE INDEX IF NOT EXISTS u ON public.t USING btree (a)"
        );
        assert_eq!(quote_ident("idx_a"), "\"idx_a\"");
    }
}
