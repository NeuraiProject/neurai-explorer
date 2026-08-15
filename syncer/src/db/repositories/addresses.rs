use bigdecimal::BigDecimal;
use sqlx::{Postgres, Transaction as SqlxTransaction};

use super::sats_to_decimal;
use crate::error::Result;

/// Accumulated balance changes for one address within a batch.
///
/// Amounts are in satoshis so that the sums are exact. `tx_count` is the
/// number of new `tx_addresses` rows (distinct transactions) the address
/// gained in the batch.
#[derive(Debug, Default, Clone)]
pub struct AddressDelta {
    pub balance: i128,
    pub received: i128,
    pub sent: i128,
    pub tx_count: i32,
}

impl AddressDelta {
    pub fn credit(&mut self, sats: i128) {
        self.balance += sats;
        self.received += sats;
    }

    pub fn debit(&mut self, sats: i128) {
        self.balance -= sats;
        self.sent += sats;
    }
}

pub struct AddressesRepository;

impl AddressesRepository {
    /// Undo every XNA move recorded at or above `height` (`tx_addresses`
    /// rows must still exist).
    pub async fn revert_from_height_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            WITH d AS (
                SELECT address, SUM(received) AS received, SUM(sent) AS sent, COUNT(*) AS n
                FROM tx_addresses
                WHERE block_height >= $1
                GROUP BY address
            )
            UPDATE addresses a SET
                balance = a.balance - d.received + d.sent,
                total_received = a.total_received - d.received,
                total_sent = a.total_sent - d.sent,
                tx_count = a.tx_count - d.n
            FROM d
            WHERE a.address = d.address
            "#,
        )
        .bind(height as i32)
        .execute(&mut **tx)
        .await?;
        Ok(result.rows_affected())
    }

    /// Remove addresses that no longer take part in any transaction, i.e.
    /// that only existed because of rolled-back blocks.
    pub async fn delete_without_history_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM addresses a
            WHERE a.tx_count = 0
              AND NOT EXISTS (SELECT 1 FROM tx_addresses t WHERE t.address = a.address)
            "#,
        )
        .execute(&mut **tx)
        .await?;
        Ok(result.rows_affected())
    }

    /// Apply many address deltas in a single upsert statement.
    ///
    /// Each address must appear at most once in `deltas`.
    pub async fn apply_deltas_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        deltas: &[(String, AddressDelta)],
    ) -> Result<()> {
        if deltas.is_empty() {
            return Ok(());
        }

        let addresses: Vec<&str> = deltas.iter().map(|(a, _)| a.as_str()).collect();
        let balances: Vec<BigDecimal> = deltas.iter().map(|(_, d)| sats_to_decimal(d.balance)).collect();
        let received: Vec<BigDecimal> = deltas.iter().map(|(_, d)| sats_to_decimal(d.received)).collect();
        let sent: Vec<BigDecimal> = deltas.iter().map(|(_, d)| sats_to_decimal(d.sent)).collect();
        let tx_counts: Vec<i32> = deltas.iter().map(|(_, d)| d.tx_count).collect();

        sqlx::query(
            r#"
            INSERT INTO addresses (address, balance, total_received, total_sent, tx_count)
            SELECT * FROM UNNEST(
                $1::text[], $2::numeric[], $3::numeric[], $4::numeric[], $5::int[]
            )
            ON CONFLICT (address) DO UPDATE SET
                balance = addresses.balance + EXCLUDED.balance,
                total_received = addresses.total_received + EXCLUDED.total_received,
                total_sent = addresses.total_sent + EXCLUDED.total_sent,
                tx_count = addresses.tx_count + EXCLUDED.tx_count
            "#,
        )
        .bind(&addresses)
        .bind(&balances)
        .bind(&received)
        .bind(&sent)
        .bind(&tx_counts)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}

/// One row of the `tx_addresses` history table: what the address received
/// and spent (in satoshis) in that transaction.
#[derive(Debug, Clone)]
pub struct TxAddressRow {
    pub txid: String,
    pub address: String,
    pub block_height: i32,
    pub time: i32,
    pub received: i128,
    pub sent: i128,
}

pub struct TxAddressesRepository;

impl TxAddressesRepository {
    /// Insert many history rows in a single statement, ignoring duplicates.
    pub async fn insert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[TxAddressRow],
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let txids: Vec<&str> = rows.iter().map(|r| r.txid.as_str()).collect();
        let addresses: Vec<&str> = rows.iter().map(|r| r.address.as_str()).collect();
        let heights: Vec<i32> = rows.iter().map(|r| r.block_height).collect();
        let times: Vec<i32> = rows.iter().map(|r| r.time).collect();
        let received: Vec<BigDecimal> = rows.iter().map(|r| sats_to_decimal(r.received)).collect();
        let sent: Vec<BigDecimal> = rows.iter().map(|r| sats_to_decimal(r.sent)).collect();

        sqlx::query(
            r#"
            INSERT INTO tx_addresses (txid, address, block_height, time, received, sent)
            SELECT * FROM UNNEST(
                $1::text[], $2::text[], $3::int[], $4::int[], $5::numeric[], $6::numeric[]
            )
            ON CONFLICT (txid, address) DO NOTHING
            "#,
        )
        .bind(&txids)
        .bind(&addresses)
        .bind(&heights)
        .bind(&times)
        .bind(&received)
        .bind(&sent)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}
