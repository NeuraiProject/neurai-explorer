use sqlx::{PgPool, Postgres, Transaction as SqlxTransaction};

use crate::error::Result;
use crate::types::Block;
use super::to_decimal;

pub struct BlocksRepository;

impl BlocksRepository {
    pub async fn insert(
        pool: &PgPool,
        block: &Block,
    ) -> Result<()> {
        let difficulty = to_decimal(block.difficulty);
        let raw_data = serde_json::to_value(block)?;

        sqlx::query(
            r#"
            INSERT INTO blocks (height, hash, time, difficulty, tx_count, raw_data)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (height) DO UPDATE SET
                hash = EXCLUDED.hash,
                time = EXCLUDED.time,
                difficulty = EXCLUDED.difficulty,
                tx_count = EXCLUDED.tx_count,
                raw_data = EXCLUDED.raw_data
            "#,
        )
        .bind(block.height as i32)
        .bind(&block.hash)
        .bind(block.time as i32)
        .bind(&difficulty)
        .bind(block.tx.len() as i32)
        .bind(&raw_data)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn insert_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        block: &Block,
    ) -> Result<()> {
        let difficulty = to_decimal(block.difficulty);
        let raw_data = serde_json::to_value(block)?;

        sqlx::query(
            r#"
            INSERT INTO blocks (height, hash, time, difficulty, tx_count, raw_data)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (height) DO UPDATE SET
                hash = EXCLUDED.hash,
                time = EXCLUDED.time,
                difficulty = EXCLUDED.difficulty,
                tx_count = EXCLUDED.tx_count,
                raw_data = EXCLUDED.raw_data
            "#,
        )
        .bind(block.height as i32)
        .bind(&block.hash)
        .bind(block.time as i32)
        .bind(&difficulty)
        .bind(block.tx.len() as i32)
        .bind(&raw_data)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub async fn get_by_height(pool: &PgPool, height: i64) -> Result<Option<String>> {
        let result: Option<(String,)> = sqlx::query_as(
            "SELECT hash FROM blocks WHERE height = $1"
        )
        .bind(height as i32)
        .fetch_optional(pool)
        .await?;

        Ok(result.map(|(hash,)| hash))
    }

    pub async fn delete_from_height(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<u64> {
        let result = sqlx::query("DELETE FROM blocks WHERE height >= $1")
            .bind(height as i32)
            .execute(&mut **tx)
            .await?;

        Ok(result.rows_affected())
    }
}
