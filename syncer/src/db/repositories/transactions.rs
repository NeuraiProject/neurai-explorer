use sqlx::{Postgres, Transaction as SqlxTransaction};

use crate::error::Result;
use crate::types::Transaction;
use super::to_decimal;

pub struct TransactionsRepository;

impl TransactionsRepository {
    pub async fn insert_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        transaction: &Transaction,
        block_height: i64,
        block_time: i64,
        total_output: f64,
    ) -> Result<()> {
        let total = to_decimal(total_output);
        let raw_data = serde_json::to_value(transaction)?;

        sqlx::query(
            r#"
            INSERT INTO transactions (txid, block_height, time, total_output, raw_data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (txid) DO UPDATE SET
                block_height = EXCLUDED.block_height,
                time = EXCLUDED.time,
                total_output = EXCLUDED.total_output,
                raw_data = EXCLUDED.raw_data
            "#,
        )
        .bind(&transaction.txid)
        .bind(block_height as i32)
        .bind(block_time as i32)
        .bind(&total)
        .bind(&raw_data)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub async fn update_raw_data_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        txid: &str,
        transaction: &Transaction,
    ) -> Result<()> {
        let raw_data = serde_json::to_value(transaction)?;

        sqlx::query("UPDATE transactions SET raw_data = $1 WHERE txid = $2")
            .bind(&raw_data)
            .bind(txid)
            .execute(&mut **tx)
            .await?;

        Ok(())
    }
}
