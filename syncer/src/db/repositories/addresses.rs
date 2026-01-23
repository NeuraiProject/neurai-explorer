use sqlx::{Postgres, Transaction as SqlxTransaction};

use crate::error::Result;
use super::to_decimal;

pub struct AddressesRepository;

impl AddressesRepository {
    async fn apply_delta_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        balance_delta: f64,
        received_delta: f64,
        sent_delta: f64,
    ) -> Result<()> {
        let balance = to_decimal(balance_delta);
        let received = to_decimal(received_delta);
        let sent = to_decimal(sent_delta);

        sqlx::query(
            r#"
            INSERT INTO addresses (address, balance, total_received, total_sent, tx_count)
            VALUES ($1, $2, $3, $4, 1)
            ON CONFLICT (address) DO UPDATE SET
                balance = addresses.balance + $2,
                total_received = addresses.total_received + $3,
                total_sent = addresses.total_sent + $4,
                tx_count = addresses.tx_count + 1
            "#,
        )
        .bind(address)
        .bind(&balance)
        .bind(&received)
        .bind(&sent)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub async fn upsert_credit_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        value: f64,
    ) -> Result<()> {
        Self::apply_delta_tx(tx, address, value, value, 0.0).await
    }

    pub async fn upsert_debit_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        value: f64,
    ) -> Result<()> {
        Self::apply_delta_tx(tx, address, -value, 0.0, value).await
    }
}

pub struct TxAddressesRepository;

impl TxAddressesRepository {
    pub async fn insert_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        txid: &str,
        address: &str,
        block_height: i64,
        block_time: i64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO tx_addresses (txid, address, block_height, time)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (txid, address) DO NOTHING
            "#,
        )
        .bind(txid)
        .bind(address)
        .bind(block_height as i32)
        .bind(block_time as i32)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}
