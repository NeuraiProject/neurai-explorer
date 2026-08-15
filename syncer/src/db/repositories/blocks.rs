use bigdecimal::BigDecimal;
use sqlx::{PgPool, Postgres, Transaction as SqlxTransaction};

use super::to_decimal;
use crate::error::Result;
use crate::types::Block;

/// One row of the `blocks` table, ready to be written.
pub struct BlockRow {
    pub height: i32,
    pub hash: String,
    pub time: i32,
    pub difficulty: BigDecimal,
    pub tx_count: i32,
    pub raw_data: serde_json::Value,
}

impl BlockRow {
    /// The stored block JSON keeps every header field but lists only the
    /// txids under `tx` (like `getblock` verbosity 1): the full transactions
    /// live in the `transactions` table.
    pub fn from_block(block: &Block) -> Result<Self> {
        let mut raw_data = serde_json::to_value(block)?;
        let txids: Vec<serde_json::Value> = block
            .tx
            .iter()
            .map(|t| serde_json::Value::String(t.txid.clone()))
            .collect();
        raw_data["tx"] = serde_json::Value::Array(txids);

        Ok(Self {
            height: block.height as i32,
            hash: block.hash.clone(),
            time: block.time as i32,
            difficulty: to_decimal(block.difficulty),
            tx_count: block.tx.len() as i32,
            raw_data,
        })
    }
}

pub struct BlocksRepository;

impl BlocksRepository {
    /// Insert (or replace) many blocks in a single statement.
    pub async fn insert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[BlockRow],
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let heights: Vec<i32> = rows.iter().map(|r| r.height).collect();
        let hashes: Vec<&str> = rows.iter().map(|r| r.hash.as_str()).collect();
        let times: Vec<i32> = rows.iter().map(|r| r.time).collect();
        let difficulties: Vec<BigDecimal> = rows.iter().map(|r| r.difficulty.clone()).collect();
        let tx_counts: Vec<i32> = rows.iter().map(|r| r.tx_count).collect();
        let raw_data: Vec<serde_json::Value> = rows.iter().map(|r| r.raw_data.clone()).collect();

        sqlx::query(
            r#"
            INSERT INTO blocks (height, hash, time, difficulty, tx_count, raw_data)
            SELECT * FROM UNNEST(
                $1::int[], $2::text[], $3::int[], $4::numeric[], $5::int[], $6::jsonb[]
            )
            ON CONFLICT (height) DO UPDATE SET
                hash = EXCLUDED.hash,
                time = EXCLUDED.time,
                difficulty = EXCLUDED.difficulty,
                tx_count = EXCLUDED.tx_count,
                raw_data = EXCLUDED.raw_data
            "#,
        )
        .bind(&heights)
        .bind(&hashes)
        .bind(&times)
        .bind(&difficulties)
        .bind(&tx_counts)
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
