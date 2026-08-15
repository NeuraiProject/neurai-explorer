use bigdecimal::{BigDecimal, ToPrimitive};
use sqlx::{Postgres, Transaction as SqlxTransaction};

use super::sats_to_decimal;
use crate::error::Result;
use crate::types::Asset;

/// Accumulated issuance/reissuance data for one asset.
///
/// Folding several events for the same asset name in chain order gives the
/// `assets` row: `amount` is summed, the "latest wins" fields keep the last
/// event, `ipfs_hash` keeps the last non-null one, and `block_height`/`txid`
/// keep the first event. The same fold is used to rebuild the row from
/// `asset_events` after a rollback.
#[derive(Debug, Clone)]
pub struct AssetUpsert {
    pub name: String,
    pub asset_type: String,
    pub amount: i128,
    pub units: i32,
    pub reissuable: bool,
    pub has_ipfs: bool,
    pub ipfs_hash: Option<String>,
    pub block_height: i32,
    pub txid: String,
}

impl AssetUpsert {
    pub fn from_event(asset: &Asset, asset_type: &str, block_height: i64, txid: &str) -> Self {
        Self {
            name: asset.name.clone(),
            asset_type: asset_type.to_string(),
            amount: asset.amount.sats() as i128,
            units: asset.units.unwrap_or(0),
            reissuable: asset.reissuable.map(|r| r != 0).unwrap_or(false),
            has_ipfs: asset.has_ipfs.map(|h| h != 0).unwrap_or(false),
            ipfs_hash: asset.ipfs_hash.clone(),
            block_height: block_height as i32,
            txid: txid.to_string(),
        }
    }

    /// Fold a later event for the same asset into this one.
    pub fn merge(&mut self, later: AssetUpsert) {
        self.asset_type = later.asset_type;
        self.amount += later.amount;
        self.units = later.units;
        self.reissuable = later.reissuable;
        self.has_ipfs = later.has_ipfs;
        if later.ipfs_hash.is_some() {
            self.ipfs_hash = later.ipfs_hash;
        }
        // block_height and txid keep the first event.
    }
}

pub struct AssetsRepository;

impl AssetsRepository {
    /// Apply many aggregated asset events in a single statement (amounts add
    /// up to the stored row). Each name must appear once.
    pub async fn upsert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[AssetUpsert],
    ) -> Result<()> {
        Self::write_many_tx(tx, rows, false).await
    }

    /// Replace the stored rows with the given ones (used to rebuild assets
    /// from their remaining events after a rollback).
    pub async fn set_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[AssetUpsert],
    ) -> Result<()> {
        Self::write_many_tx(tx, rows, true).await
    }

    async fn write_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[AssetUpsert],
        replace: bool,
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        let types: Vec<&str> = rows.iter().map(|r| r.asset_type.as_str()).collect();
        let amounts: Vec<BigDecimal> = rows.iter().map(|r| sats_to_decimal(r.amount)).collect();
        let units: Vec<i32> = rows.iter().map(|r| r.units).collect();
        let reissuable: Vec<bool> = rows.iter().map(|r| r.reissuable).collect();
        let has_ipfs: Vec<bool> = rows.iter().map(|r| r.has_ipfs).collect();
        let ipfs_hashes: Vec<Option<&str>> = rows.iter().map(|r| r.ipfs_hash.as_deref()).collect();
        let heights: Vec<i32> = rows.iter().map(|r| r.block_height).collect();
        let txids: Vec<&str> = rows.iter().map(|r| r.txid.as_str()).collect();

        let sql = if replace {
            r#"
            INSERT INTO assets (name, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height, txid)
            SELECT * FROM UNNEST(
                $1::text[], $2::text[], $3::numeric[], $4::int[], $5::bool[],
                $6::bool[], $7::text[], $8::int[], $9::text[]
            )
            ON CONFLICT (name) DO UPDATE SET
                type = EXCLUDED.type,
                amount = EXCLUDED.amount,
                units = EXCLUDED.units,
                reissuable = EXCLUDED.reissuable,
                has_ipfs = EXCLUDED.has_ipfs,
                ipfs_hash = EXCLUDED.ipfs_hash,
                block_height = EXCLUDED.block_height,
                txid = EXCLUDED.txid
            "#
        } else {
            r#"
            INSERT INTO assets (name, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height, txid)
            SELECT * FROM UNNEST(
                $1::text[], $2::text[], $3::numeric[], $4::int[], $5::bool[],
                $6::bool[], $7::text[], $8::int[], $9::text[]
            )
            ON CONFLICT (name) DO UPDATE SET
                type = COALESCE(EXCLUDED.type, assets.type),
                amount = assets.amount + EXCLUDED.amount,
                units = COALESCE(EXCLUDED.units, assets.units),
                reissuable = COALESCE(EXCLUDED.reissuable, assets.reissuable),
                has_ipfs = COALESCE(EXCLUDED.has_ipfs, assets.has_ipfs),
                ipfs_hash = COALESCE(EXCLUDED.ipfs_hash, assets.ipfs_hash)
            "#
        };

        sqlx::query(sql)
            .bind(&names)
            .bind(&types)
            .bind(&amounts)
            .bind(&units)
            .bind(&reissuable)
            .bind(&has_ipfs)
            .bind(&ipfs_hashes)
            .bind(&heights)
            .bind(&txids)
            .execute(&mut **tx)
            .await?;

        Ok(())
    }

    /// Delete assets by name (cascades to address_assets and asset_events).
    pub async fn delete_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        names: &[String],
    ) -> Result<u64> {
        if names.is_empty() {
            return Ok(0);
        }
        let result = sqlx::query("DELETE FROM assets WHERE name = ANY($1)")
            .bind(names)
            .execute(&mut **tx)
            .await?;
        Ok(result.rows_affected())
    }
}

/// One issuance / reissuance output, as stored in `asset_events`.
#[derive(Debug, Clone)]
pub struct AssetEventRow {
    pub txid: String,
    pub vout_n: i32,
    pub block_height: i32,
    pub tx_index: i32,
    pub event: AssetUpsert,
}

pub struct AssetEventsRepository;

impl AssetEventsRepository {
    pub async fn insert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[AssetEventRow],
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let txids: Vec<&str> = rows.iter().map(|r| r.txid.as_str()).collect();
        let vouts: Vec<i32> = rows.iter().map(|r| r.vout_n).collect();
        let names: Vec<&str> = rows.iter().map(|r| r.event.name.as_str()).collect();
        let heights: Vec<i32> = rows.iter().map(|r| r.block_height).collect();
        let indexes: Vec<i32> = rows.iter().map(|r| r.tx_index).collect();
        let types: Vec<&str> = rows.iter().map(|r| r.event.asset_type.as_str()).collect();
        let amounts: Vec<BigDecimal> = rows.iter().map(|r| sats_to_decimal(r.event.amount)).collect();
        let units: Vec<i32> = rows.iter().map(|r| r.event.units).collect();
        let reissuable: Vec<bool> = rows.iter().map(|r| r.event.reissuable).collect();
        let has_ipfs: Vec<bool> = rows.iter().map(|r| r.event.has_ipfs).collect();
        let ipfs_hashes: Vec<Option<&str>> = rows.iter().map(|r| r.event.ipfs_hash.as_deref()).collect();

        sqlx::query(
            r#"
            INSERT INTO asset_events
                (txid, vout_n, asset_name, block_height, tx_index, type, amount, units, reissuable, has_ipfs, ipfs_hash)
            SELECT * FROM UNNEST(
                $1::text[], $2::int[], $3::text[], $4::int[], $5::int[], $6::text[],
                $7::numeric[], $8::int[], $9::bool[], $10::bool[], $11::text[]
            )
            ON CONFLICT (txid, vout_n) DO NOTHING
            "#,
        )
        .bind(&txids)
        .bind(&vouts)
        .bind(&names)
        .bind(&heights)
        .bind(&indexes)
        .bind(&types)
        .bind(&amounts)
        .bind(&units)
        .bind(&reissuable)
        .bind(&has_ipfs)
        .bind(&ipfs_hashes)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    /// Names of the assets with at least one event at or above `height`.
    pub async fn names_from_height_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT asset_name FROM asset_events WHERE block_height >= $1",
        )
        .bind(height as i32)
        .fetch_all(&mut **tx)
        .await?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    /// Fold the stored events of the given assets, in chain order, into the
    /// `assets` rows they define. Assets with no events left are absent.
    pub async fn fold_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        names: &[String],
    ) -> Result<Vec<AssetUpsert>> {
        if names.is_empty() {
            return Ok(Vec::new());
        }

        #[allow(clippy::type_complexity)]
        let rows: Vec<(String, String, String, BigDecimal, i32, bool, bool, Option<String>, i32)> =
            sqlx::query_as(
                r#"
                SELECT asset_name, txid, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height
                FROM asset_events
                WHERE asset_name = ANY($1)
                ORDER BY block_height, tx_index, vout_n
                "#,
            )
            .bind(names)
            .fetch_all(&mut **tx)
            .await?;

        let mut folded: Vec<AssetUpsert> = Vec::new();
        for (name, txid, asset_type, amount, units, reissuable, has_ipfs, ipfs_hash, height) in rows {
            let sats = (amount * BigDecimal::from(100_000_000i64))
                .to_i128()
                .unwrap_or(0);
            let event = AssetUpsert {
                name: name.clone(),
                asset_type,
                amount: sats,
                units,
                reissuable,
                has_ipfs,
                ipfs_hash,
                block_height: height,
                txid,
            };
            match folded.iter_mut().find(|a| a.name == name) {
                Some(existing) => existing.merge(event),
                None => folded.push(event),
            }
        }

        Ok(folded)
    }
}

/// Accumulated asset balance change for one (address, asset) pair.
#[derive(Debug, Clone)]
pub struct AddressAssetDelta {
    pub address: String,
    pub asset_name: String,
    pub balance: i128,
}

pub struct AddressAssetsRepository;

impl AddressAssetsRepository {
    /// Apply many asset balance deltas in a single upsert statement.
    /// Each (address, asset_name) pair must appear once.
    pub async fn apply_deltas_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        deltas: &[AddressAssetDelta],
    ) -> Result<()> {
        if deltas.is_empty() {
            return Ok(());
        }

        let addresses: Vec<&str> = deltas.iter().map(|d| d.address.as_str()).collect();
        let names: Vec<&str> = deltas.iter().map(|d| d.asset_name.as_str()).collect();
        let balances: Vec<BigDecimal> = deltas.iter().map(|d| sats_to_decimal(d.balance)).collect();

        sqlx::query(
            r#"
            INSERT INTO address_assets (address, asset_name, balance)
            SELECT * FROM UNNEST($1::text[], $2::text[], $3::numeric[])
            ON CONFLICT (address, asset_name) DO UPDATE SET
                balance = address_assets.balance + EXCLUDED.balance
            "#,
        )
        .bind(&addresses)
        .bind(&names)
        .bind(&balances)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    /// Undo every asset move recorded at or above `height`
    /// (`tx_address_assets` rows must still exist).
    pub async fn revert_from_height_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        height: i64,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            WITH d AS (
                SELECT address, asset_name, SUM(delta) AS delta
                FROM tx_address_assets
                WHERE block_height >= $1
                GROUP BY address, asset_name
            )
            UPDATE address_assets aa
            SET balance = aa.balance - d.delta
            FROM d
            WHERE aa.address = d.address AND aa.asset_name = d.asset_name
            "#,
        )
        .bind(height as i32)
        .execute(&mut **tx)
        .await?;
        Ok(result.rows_affected())
    }

    /// Remove (address, asset) rows that no longer have any history behind
    /// them, i.e. that only existed because of rolled-back blocks.
    pub async fn delete_without_history_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM address_assets aa
            WHERE aa.balance = 0
              AND NOT EXISTS (
                  SELECT 1 FROM tx_address_assets t
                  WHERE t.address = aa.address AND t.asset_name = aa.asset_name
              )
            "#,
        )
        .execute(&mut **tx)
        .await?;
        Ok(result.rows_affected())
    }
}

/// Accumulated asset balance change for one (address, asset) pair, per tx.
#[derive(Debug, Clone)]
pub struct TxAddressAssetRow {
    pub txid: String,
    pub address: String,
    pub asset_name: String,
    pub delta: i128,
    pub block_height: i32,
}

pub struct TxAddressAssetsRepository;

impl TxAddressAssetsRepository {
    /// Insert many rows in a single statement, ignoring duplicates.
    pub async fn insert_many_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        rows: &[TxAddressAssetRow],
    ) -> Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let txids: Vec<&str> = rows.iter().map(|r| r.txid.as_str()).collect();
        let addresses: Vec<&str> = rows.iter().map(|r| r.address.as_str()).collect();
        let names: Vec<&str> = rows.iter().map(|r| r.asset_name.as_str()).collect();
        let deltas: Vec<BigDecimal> = rows.iter().map(|r| sats_to_decimal(r.delta)).collect();
        let heights: Vec<i32> = rows.iter().map(|r| r.block_height).collect();

        sqlx::query(
            r#"
            INSERT INTO tx_address_assets (txid, address, asset_name, delta, block_height)
            SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::numeric[], $5::int[])
            ON CONFLICT (txid, address, asset_name) DO NOTHING
            "#,
        )
        .bind(&txids)
        .bind(&addresses)
        .bind(&names)
        .bind(&deltas)
        .bind(&heights)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}
