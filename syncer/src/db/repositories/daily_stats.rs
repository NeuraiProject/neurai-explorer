use chrono::NaiveDate;
use sqlx::PgPool;
use tracing::debug;

use crate::error::Result;

pub struct DailyStatsRepository;

impl DailyStatsRepository {
    pub async fn latest_date(pool: &PgPool) -> Result<Option<NaiveDate>> {
        let row: Option<(NaiveDate,)> = sqlx::query_as(
            "SELECT date FROM daily_stats ORDER BY date DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|(date,)| date))
    }

    pub async fn aggregate_from_date(pool: &PgPool, date: NaiveDate) -> Result<()> {
        debug!(%date, "Aggregating daily stats");

        sqlx::query(
            r#"
            WITH block_stats AS (
                SELECT
                    to_timestamp(b.time)::date as day,
                    COUNT(*) as blk_cnt,
                    SUM(difficulty) as sum_diff,
                    SUM(tx_count) as tx_cnt,
                    SUM((raw_data->>'size')::bigint) as sum_size,
                    SUM(50000 * POWER(0.95, FLOOR(b.height::numeric / 14400))) as new_sup
                FROM blocks b
                WHERE to_timestamp(b.time)::date >= $1::date
                GROUP BY 1
            ),
            vol_stats AS (
                SELECT
                    to_timestamp(b.time)::date as day,
                    SUM(t.total_output) as vol
                FROM transactions t
                JOIN blocks b ON t.block_height = b.height
                WHERE to_timestamp(b.time)::date >= $1::date
                GROUP BY 1
            ),
            asset_stats AS (
                SELECT
                    to_timestamp(b.time)::date as day,
                    COUNT(*) as new_assets
                FROM assets a
                JOIN blocks b ON a.block_height = b.height
                WHERE to_timestamp(b.time)::date >= $1::date
                GROUP BY 1
            ),
            addr_stats AS (
                SELECT
                    to_timestamp(time)::date as day,
                    COUNT(DISTINCT address) as active_addrs
                FROM tx_addresses
                WHERE to_timestamp(time)::date >= $1::date
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
                bs.new_sup
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
        .bind(date)
        .execute(pool)
        .await?;

        Ok(())
    }
}
