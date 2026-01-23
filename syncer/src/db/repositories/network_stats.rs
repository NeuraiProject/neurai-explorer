use bigdecimal::{BigDecimal, ToPrimitive};
use sqlx::PgPool;

use crate::error::Result;
use crate::types::PeerInfo;

pub struct NetworkStatsRepository;

impl NetworkStatsRepository {
    pub async fn update(
        pool: &PgPool,
        difficulty: f64,
        hashrate: f64,
        connections: i32,
        height: i64,
        supply: f64,
        peers_data: &[PeerInfo],
    ) -> Result<()> {
        let difficulty_bd = BigDecimal::try_from(difficulty).unwrap_or_default();
        let hashrate_bd = BigDecimal::try_from(hashrate).unwrap_or_default();
        let supply_bd = BigDecimal::try_from(supply).unwrap_or_default();
        let peers_json = serde_json::to_value(peers_data)?;
        let now = chrono::Utc::now().timestamp() as i32;

        sqlx::query(
            r#"
            INSERT INTO network_stats (id, difficulty, hashrate, connections, height, supply, peers_data, updated_at)
            VALUES (1, $1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                difficulty = $1,
                hashrate = $2,
                connections = $3,
                height = $4,
                supply = $5,
                peers_data = $6,
                updated_at = $7
            "#,
        )
        .bind(&difficulty_bd)
        .bind(&hashrate_bd)
        .bind(connections)
        .bind(height as i32)
        .bind(&supply_bd)
        .bind(&peers_json)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn update_price(
        pool: &PgPool,
        price_usd: f64,
        market_cap_usd: f64,
    ) -> Result<()> {
        let price_bd = BigDecimal::try_from(price_usd).unwrap_or_default();
        let mcap_bd = BigDecimal::try_from(market_cap_usd).unwrap_or_default();
        let now = chrono::Utc::now().timestamp() as i32;

        sqlx::query(
            r#"
            INSERT INTO network_stats (id, price_usd, market_cap_usd, updated_at)
            VALUES (1, $1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET
                price_usd = EXCLUDED.price_usd,
                market_cap_usd = EXCLUDED.market_cap_usd,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(&price_bd)
        .bind(&mcap_bd)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn get_supply(pool: &PgPool) -> Result<f64> {
        let result: Option<(Option<BigDecimal>,)> = sqlx::query_as(
            "SELECT supply FROM network_stats WHERE id = 1"
        )
        .fetch_optional(pool)
        .await?;

        let supply = result
            .and_then(|(value,)| value)
            .and_then(|value| value.to_f64())
            .unwrap_or(0.0);

        Ok(supply)
    }
}
