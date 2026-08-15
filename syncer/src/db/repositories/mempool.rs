use sqlx::PgPool;

use crate::error::Result;
use crate::types::{decode_hex, Transaction};

pub struct MempoolRepository;

impl MempoolRepository {
    /// Store an unconfirmed transaction: decoded JSON without `hex` (same
    /// layout as `transactions.raw_data`) plus the raw bytes in `raw_hex`.
    pub async fn upsert(
        pool: &PgPool,
        transaction: &Transaction,
    ) -> Result<()> {
        let mut stored = transaction.clone();
        let raw_hex = stored.hex.take().and_then(|h| decode_hex(&h));
        let raw_data = serde_json::to_value(&stored)?;
        let now = chrono::Utc::now().timestamp() as i32;

        sqlx::query(
            r#"
            INSERT INTO mempool (txid, time, raw_data, raw_hex)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (txid) DO UPDATE SET
                time = EXCLUDED.time,
                raw_data = EXCLUDED.raw_data,
                raw_hex = EXCLUDED.raw_hex
            "#,
        )
        .bind(&transaction.txid)
        .bind(now)
        .bind(&raw_data)
        .bind(&raw_hex)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn get_all_txids(pool: &PgPool) -> Result<Vec<String>> {
        let result: Vec<(String,)> = sqlx::query_as("SELECT txid FROM mempool")
            .fetch_all(pool)
            .await?;

        Ok(result.into_iter().map(|(txid,)| txid).collect())
    }

    pub async fn delete(pool: &PgPool, txid: &str) -> Result<()> {
        sqlx::query("DELETE FROM mempool WHERE txid = $1")
            .bind(txid)
            .execute(pool)
            .await?;

        Ok(())
    }
}
