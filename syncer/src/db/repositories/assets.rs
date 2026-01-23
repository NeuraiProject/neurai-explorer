use sqlx::{Postgres, Transaction as SqlxTransaction};

use crate::error::Result;
use crate::types::Asset;
use super::to_decimal;

pub struct AssetsRepository;

impl AssetsRepository {
    pub async fn upsert_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        asset: &Asset,
        asset_type: &str,
        block_height: i64,
        txid: &str,
    ) -> Result<()> {
        let amount = to_decimal(asset.amount);
        let units = asset.units.unwrap_or(0);
        let reissuable = asset.reissuable.map(|r| r != 0).unwrap_or(false);
        let has_ipfs = asset.has_ipfs.map(|h| h != 0).unwrap_or(false);

        sqlx::query(
            r#"
            INSERT INTO assets (name, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height, txid)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (name) DO UPDATE SET
                type = COALESCE(EXCLUDED.type, assets.type),
                amount = assets.amount + EXCLUDED.amount,
                units = COALESCE(EXCLUDED.units, assets.units),
                reissuable = COALESCE(EXCLUDED.reissuable, assets.reissuable),
                has_ipfs = COALESCE(EXCLUDED.has_ipfs, assets.has_ipfs),
                ipfs_hash = COALESCE(EXCLUDED.ipfs_hash, assets.ipfs_hash)
            "#,
        )
        .bind(&asset.name)
        .bind(asset_type)
        .bind(&amount)
        .bind(units)
        .bind(reissuable)
        .bind(has_ipfs)
        .bind(&asset.ipfs_hash)
        .bind(block_height as i32)
        .bind(txid)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }
}

pub struct AddressAssetsRepository;

impl AddressAssetsRepository {
    async fn apply_delta_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        asset_name: &str,
        delta: f64,
    ) -> Result<()> {
        let amt = to_decimal(delta);

        sqlx::query(
            r#"
            INSERT INTO address_assets (address, asset_name, balance)
            VALUES ($1, $2, $3)
            ON CONFLICT (address, asset_name) DO UPDATE SET
                balance = address_assets.balance + $3
            "#,
        )
        .bind(address)
        .bind(asset_name)
        .bind(&amt)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub async fn upsert_credit_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        asset_name: &str,
        amount: f64,
    ) -> Result<()> {
        Self::apply_delta_tx(tx, address, asset_name, amount).await
    }

    pub async fn upsert_debit_tx(
        tx: &mut SqlxTransaction<'_, Postgres>,
        address: &str,
        asset_name: &str,
        amount: f64,
    ) -> Result<()> {
        Self::apply_delta_tx(tx, address, asset_name, -amount).await
    }
}
