use chrono::NaiveDate;
use sqlx::{PgPool, Postgres, Transaction as SqlxTransaction};
use tracing::debug;

use crate::error::Result;

/// Version of the aggregation logic. When it changes, the whole table is
/// recomputed on the next start (see `ensure_version`).
pub const DAILY_STATS_VERSION: &str = "2";

pub struct DailyStatsRepository;

impl DailyStatsRepository {
    /// Wipe `daily_stats` if it was computed by an older aggregation, so the
    /// next `aggregate_from_date` rebuilds it from the beginning. Returns
    /// true when a rebuild was scheduled.
    pub async fn ensure_version(pool: &PgPool) -> Result<bool> {
        let stored: Option<(Option<String>,)> =
            sqlx::query_as("SELECT value FROM sync_state WHERE key = 'daily_stats_version'")
                .fetch_optional(pool)
                .await?;
        if stored.and_then(|(v,)| v).as_deref() == Some(DAILY_STATS_VERSION) {
            return Ok(false);
        }
        let mut tx = pool.begin().await?;
        sqlx::query("TRUNCATE daily_stats").execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO sync_state (key, value) VALUES ('daily_stats_version', $1) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        )
        .bind(DAILY_STATS_VERSION)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn latest_date(pool: &PgPool) -> Result<Option<NaiveDate>> {
        let row: Option<(NaiveDate,)> = sqlx::query_as(
            "SELECT date FROM daily_stats ORDER BY date DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|(date,)| date))
    }

    /// Drop the daily rows covering blocks at or above `height`, so that they
    /// are recomputed by the next aggregation after a rollback.
    pub async fn delete_from_block_height_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM daily_stats
            WHERE date >= (SELECT to_timestamp(MIN(time))::date FROM blocks WHERE height >= $1)
            "#,
        )
        .bind(height as i32)
        .execute(&mut **tx)
        .await?;
        Ok(result.rows_affected())
    }

    /// Recompute the daily rows from `date` (UTC) onwards.
    ///
    /// Filters on the integer `time` columns (`blocks.time`,
    /// `transactions.time`, `tx_addresses.time` all hold the block time), so
    /// the indexes on them are used instead of scanning every row through
    /// `to_timestamp(...)::date`. Days are computed in UTC explicitly, not in
    /// the session time zone.
    pub async fn aggregate_from_date(pool: &PgPool, date: NaiveDate) -> Result<()> {
        debug!(%date, "Aggregating daily stats");

        let since = date
            .and_hms_opt(0, 0, 0)
            .expect("midnight exists")
            .and_utc()
            .timestamp() as i32;

        sqlx::query(
            r#"
            WITH block_stats AS (
                SELECT
                    (to_timestamp(b.time) AT TIME ZONE 'UTC')::date AS day,
                    COUNT(*) AS blk_cnt,
                    SUM(difficulty) AS sum_diff,
                    SUM(tx_count) AS tx_cnt,
                    SUM((raw_data->>'size')::bigint) AS sum_size
                FROM blocks b
                WHERE b.time >= $1
                GROUP BY 1
            ),
            vol_stats AS (
                SELECT
                    (to_timestamp(t.time) AT TIME ZONE 'UTC')::date AS day,
                    SUM(t.total_output) AS vol,
                    -- Newly issued coins: what the coinbases paid out minus
                    -- the fees they collected from the other transactions.
                    SUM(CASE WHEN t.tx_index = 0 THEN t.total_output
                             ELSE -COALESCE(t.fee, 0) END) AS new_sup
                FROM transactions t
                WHERE t.time >= $1
                GROUP BY 1
            ),
            asset_stats AS (
                SELECT
                    (to_timestamp(b.time) AT TIME ZONE 'UTC')::date AS day,
                    COUNT(*) AS new_assets
                FROM assets a
                JOIN blocks b ON a.block_height = b.height
                WHERE b.time >= $1
                GROUP BY 1
            ),
            addr_stats AS (
                SELECT
                    (to_timestamp(time) AT TIME ZONE 'UTC')::date AS day,
                    COUNT(DISTINCT address) AS active_addrs
                FROM tx_addresses
                WHERE time >= $1
                GROUP BY 1
            )
            INSERT INTO daily_stats (
                date,
                tx_count,
                total_output,
                sum_difficulty,
                block_count,
                new_assets_count,
                active_address_count,
                burned_coins,
                sum_block_size,
                new_supply
            )
            SELECT
                bs.day,
                bs.tx_cnt,
                COALESCE(vs.vol, 0),
                bs.sum_diff,
                bs.blk_cnt,
                COALESCE(ans.new_assets, 0),
                COALESCE(ads.active_addrs, 0),
                0,
                bs.sum_size,
                COALESCE(vs.new_sup, 0)
            FROM block_stats bs
            LEFT JOIN vol_stats vs ON bs.day = vs.day
            LEFT JOIN asset_stats ans ON bs.day = ans.day
            LEFT JOIN addr_stats ads ON bs.day = ads.day
            ON CONFLICT (date) DO UPDATE SET
                tx_count = EXCLUDED.tx_count,
                total_output = EXCLUDED.total_output,
                sum_difficulty = EXCLUDED.sum_difficulty,
                block_count = EXCLUDED.block_count,
                new_assets_count = EXCLUDED.new_assets_count,
                sum_block_size = EXCLUDED.sum_block_size,
                new_supply = EXCLUDED.new_supply,
                active_address_count = EXCLUDED.active_address_count,
                burned_coins = EXCLUDED.burned_coins
            "#,
        )
        .bind(since)
        .execute(pool)
        .await?;

        Ok(())
    }
}
