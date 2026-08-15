use bigdecimal::BigDecimal;
use sqlx::{Postgres, Transaction as SqlxTransaction};

use crate::error::Result;

/// One row of the `transactions` table, ready to be written.
pub struct TransactionRow {
    pub txid: String,
    pub block_height: i32,
    /// Position of the transaction inside its block (0 = coinbase).
    pub tx_index: i32,
    pub time: i32,
    pub total_output: BigDecimal,
    /// Decoded transaction JSON, without `hex`.
    pub raw_data: serde_json::Value,
    /// Serialized transaction bytes.
    pub raw_hex: Option<Vec<u8>>,
}

pub struct TransactionsRepository;

impl TransactionsRepository {
    /// Insert (or replace) many transactions in a single statement.
    ///
    /// `rows` must not contain the same txid twice (Postgres rejects an
    /// `ON CONFLICT DO UPDATE` that touches a row twice in one statement).
    pub async fn insert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[TransactionRow],
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let txids: Vec<&str> = rows.iter().map(|r| r.txid.as_str()).collect();
        let heights: Vec<i32> = rows.iter().map(|r| r.block_height).collect();
        let indexes: Vec<i32> = rows.iter().map(|r| r.tx_index).collect();
        let times: Vec<i32> = rows.iter().map(|r| r.time).collect();
        let totals: Vec<BigDecimal> = rows.iter().map(|r| r.total_output.clone()).collect();
        let raw_data: Vec<serde_json::Value> = rows.iter().map(|r| r.raw_data.clone()).collect();
        let raw_hex: Vec<Option<&[u8]>> = rows.iter().map(|r| r.raw_hex.as_deref()).collect();

        sqlx::query(
            r#"
            INSERT INTO transactions (txid, block_height, tx_index, time, total_output, raw_data, raw_hex)
            SELECT * FROM UNNEST(
                $1::text[], $2::int[], $3::int[], $4::int[], $5::numeric[], $6::jsonb[], $7::bytea[]
            )
            ON CONFLICT (txid) DO UPDATE SET
                block_height = EXCLUDED.block_height,
                tx_index = EXCLUDED.tx_index,
                time = EXCLUDED.time,
                total_output = EXCLUDED.total_output,
                raw_data = EXCLUDED.raw_data,
                raw_hex = EXCLUDED.raw_hex
            "#,
        )
        .bind(&txids)
        .bind(&heights)
        .bind(&indexes)
        .bind(&times)
        .bind(&totals)
        .bind(&raw_data)
        .bind(&raw_hex)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}
