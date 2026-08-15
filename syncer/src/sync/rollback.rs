use tracing::info;

use crate::db::repositories::{
    AddressAssetsRepository, AddressesRepository, AssetEventsRepository, AssetsRepository,
    BlocksRepository, DailyStatsRepository, SyncStateRepository,
};
use crate::db::DbPool;
use crate::error::Result;

/// Undo everything the syncer derived from blocks at or above `height`, in one
/// database transaction, leaving the database exactly as if those blocks had
/// never been synced.
///
/// The ledgers are sums of the per-transaction history rows, so:
/// 1. `addresses` and `address_assets` get the history at/above `height`
///    subtracted;
/// 2. the blocks are deleted (cascading to transactions, `tx_addresses`,
///    `tx_address_assets` and `asset_events`);
/// 3. every asset that had an issuance/reissuance in those blocks is rebuilt
///    from its remaining events, or deleted if none are left;
/// 4. addresses / (address, asset) pairs with no history left are removed;
/// 5. the daily stats of the affected days are dropped (recomputed by the
///    next aggregation) and `sync_state.last_height` moves to `height - 1`.
pub async fn rollback_from_height(pool: &DbPool, height: i64) -> Result<RollbackReport> {
    let height = height.max(0);
    let mut tx = pool.begin().await?;

    // Never move the sync state forward: rolling back to a height above the
    // synced tip is a no-op.
    let db_height = SyncStateRepository::get_last_height_tx(&mut tx).await?.unwrap_or(-1);
    if height > db_height {
        info!(height, db_height, "Nothing to roll back");
        return Ok(RollbackReport::empty(height));
    }

    let addresses_reverted = AddressesRepository::revert_from_height_tx(&mut tx, height).await?;
    let asset_balances_reverted =
        AddressAssetsRepository::revert_from_height_tx(&mut tx, height).await?;

    // Which assets need rebuilding (their events at/above `height` are about
    // to be deleted with the blocks).
    let touched_assets = AssetEventsRepository::names_from_height_tx(&mut tx, height).await?;

    // Needs the blocks' timestamps, so before deleting them.
    DailyStatsRepository::delete_from_block_height_tx(&mut tx, height).await?;

    let blocks_deleted = BlocksRepository::delete_from_height(&mut tx, height).await?;

    let rebuilt = AssetEventsRepository::fold_tx(&mut tx, &touched_assets).await?;
    let gone: Vec<String> = touched_assets
        .iter()
        .filter(|name| !rebuilt.iter().any(|a| &a.name == *name))
        .cloned()
        .collect();
    AssetsRepository::set_many_tx(&mut tx, &rebuilt).await?;
    let assets_deleted = AssetsRepository::delete_many_tx(&mut tx, &gone).await?;

    let asset_pairs_removed = AddressAssetsRepository::delete_without_history_tx(&mut tx).await?;
    let addresses_removed = AddressesRepository::delete_without_history_tx(&mut tx).await?;

    SyncStateRepository::set_last_height_tx(&mut tx, height - 1).await?;

    tx.commit().await?;

    let report = RollbackReport {
        height,
        blocks_deleted,
        addresses_reverted,
        addresses_removed,
        asset_balances_reverted,
        asset_pairs_removed,
        assets_rebuilt: rebuilt.len() as u64,
        assets_deleted,
    };
    info!(%report, "Rollback complete");
    Ok(report)
}

impl RollbackReport {
    fn empty(height: i64) -> Self {
        Self {
            height,
            blocks_deleted: 0,
            addresses_reverted: 0,
            addresses_removed: 0,
            asset_balances_reverted: 0,
            asset_pairs_removed: 0,
            assets_rebuilt: 0,
            assets_deleted: 0,
        }
    }
}

impl std::fmt::Display for RollbackReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "height >= {}: {} blocks deleted, {} addresses reverted ({} removed), \
             {} asset balances reverted ({} pairs removed), {} assets rebuilt, {} deleted",
            self.height,
            self.blocks_deleted,
            self.addresses_reverted,
            self.addresses_removed,
            self.asset_balances_reverted,
            self.asset_pairs_removed,
            self.assets_rebuilt,
            self.assets_deleted
        )
    }
}

#[derive(Debug)]
pub struct RollbackReport {
    pub height: i64,
    pub blocks_deleted: u64,
    pub addresses_reverted: u64,
    pub addresses_removed: u64,
    pub asset_balances_reverted: u64,
    pub asset_pairs_removed: u64,
    pub assets_rebuilt: u64,
    pub assets_deleted: u64,
}
