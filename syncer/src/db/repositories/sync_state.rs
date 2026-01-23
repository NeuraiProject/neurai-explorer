use sqlx::{Executor, PgPool, Postgres, Transaction as SqlxTransaction};

use crate::error::Result;

pub struct SyncStateRepository;

impl SyncStateRepository {
    async fn set_last_height_internal<'e, E>(executor: E, height: i64) -> Result<()>
    where
        E: Executor<'e, Database = Postgres>,
    {
        sqlx::query(
            r#"
            INSERT INTO sync_state (key, value)
            VALUES ('last_height', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1
            "#,
        )
        .bind(height.to_string())
        .execute(executor)
        .await?;

        Ok(())
    }

    pub async fn get_last_height(pool: &PgPool) -> Result<Option<i64>> {
        let result: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT value FROM sync_state WHERE key = 'last_height'"
        )
        .fetch_optional(pool)
        .await?;

        Ok(result
            .and_then(|(v,)| v)
            .and_then(|v| v.parse().ok()))
    }

    pub async fn set_last_height_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<()> {
        Self::set_last_height_internal(&mut **tx, height).await
    }

    pub async fn set_last_height(pool: &PgPool, height: i64) -> Result<()> {
        Self::set_last_height_internal(pool, height).await
    }
}
