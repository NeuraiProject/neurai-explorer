use sqlx::PgPool;

use crate::error::Result;
use crate::types::Transaction;

pub struct MempoolRepository;

impl MempoolRepository {
    pub async fn upsert(
        pool: &PgPool,
        transaction: &Transaction,
    ) -> Result<()> {
        let raw_data = serde_json::to_value(transaction)?;
        let now = chrono::Utc::now().timestamp() as i32;

        sqlx::query(
            r#"
            INSERT INTO mempool (txid, time, raw_data)
            VALUES ($1, $2, $3)
            ON CONFLICT (txid) DO UPDATE SET
                time = EXCLUDED.time,
                raw_data = EXCLUDED.raw_data
            "#,
        )
        .bind(&transaction.txid)
        .bind(now)
        .bind(&raw_data)
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

    pub async fn clear(pool: &PgPool) -> Result<()> {
        sqlx::query("DELETE FROM mempool")
            .execute(pool)
            .await?;

        Ok(())
    }
}
