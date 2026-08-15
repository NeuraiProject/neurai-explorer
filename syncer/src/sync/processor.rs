use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use futures::stream::{self, StreamExt};
use tracing::debug;

use crate::db::repositories::{
    sats_to_decimal, AddressAssetDelta, AddressAssetsRepository, AddressDelta,
    AddressesRepository, AssetEventRow, AssetEventsRepository, AssetUpsert, AssetsRepository,
    BlockRow, BlocksRepository, SyncStateRepository, TransactionRow, TransactionsRepository,
    TxAddressAssetRow, TxAddressAssetsRepository, TxAddressRow, TxAddressesRepository,
};
use crate::db::DbPool;
use crate::error::{Result, SyncerError};
use crate::rpc::RpcClient;
use crate::types::{decode_hex, Block, Transaction};

use super::cache::{prev_outs_of, PrevOutCache, PrevOuts};

/// Maximum number of rows sent in one multi-row statement. Keeps individual
/// statements (and their JSONB payloads) at a reasonable size on busy blocks.
const STATEMENT_CHUNK_ROWS: usize = 2_000;

/// A run of consecutive blocks together with everything needed to index them
/// without further RPC calls.
pub struct PreparedBatch {
    pub blocks: Vec<Block>,
    /// Outputs of every transaction referenced by a non-coinbase input in
    /// `blocks`, keyed by txid.
    pub prev_outs: HashMap<String, PrevOuts>,
}

impl PreparedBatch {
    pub fn first(&self) -> &Block {
        &self.blocks[0]
    }

    pub fn last(&self) -> &Block {
        &self.blocks[self.blocks.len() - 1]
    }

    pub fn tx_count(&self) -> usize {
        self.blocks.iter().map(|b| b.tx.len()).sum()
    }
}

/// Resolve the previous outputs spent by `blocks`.
///
/// Outputs are looked up, in order, in the batch itself, in the cache, and
/// finally on the node (concurrently). Every transaction of the batch is added
/// to the cache so that later batches spending its outputs do not need RPC.
///
/// Fails if any referenced transaction cannot be obtained: indexing the batch
/// without it would silently corrupt address balances.
pub async fn prepare_batch(
    rpc: &RpcClient,
    blocks: Vec<Block>,
    cache: &Mutex<PrevOutCache>,
    fetch_concurrency: usize,
) -> Result<PreparedBatch> {
    let mut needed: HashSet<&str> = HashSet::new();
    for block in &blocks {
        for tx in &block.tx {
            for vin in &tx.vin {
                if vin.is_coinbase() {
                    continue;
                }
                if let Some(ref txid) = vin.txid {
                    needed.insert(txid.as_str());
                }
            }
        }
    }

    let mut prev_outs: HashMap<String, PrevOuts> = HashMap::with_capacity(needed.len());

    // 1. Outputs created within this batch (and remember them for later batches).
    {
        let mut cache = cache.lock().expect("prev-out cache poisoned");
        for block in &blocks {
            for tx in &block.tx {
                let outs = prev_outs_of(tx);
                if needed.contains(tx.txid.as_str()) {
                    prev_outs.insert(tx.txid.clone(), outs.clone());
                }
                cache.insert(tx.txid.clone(), outs);
            }
        }

        // 2. Outputs seen in earlier batches.
        for txid in &needed {
            if prev_outs.contains_key(*txid) {
                continue;
            }
            if let Some(outs) = cache.get(txid) {
                prev_outs.insert((*txid).to_string(), outs);
            }
        }
    }

    // 3. Everything else comes from the node.
    let missing: Vec<String> = needed
        .iter()
        .filter(|txid| !prev_outs.contains_key(**txid))
        .map(|txid| (*txid).to_string())
        .collect();

    debug!(
        needed = needed.len(),
        from_batch_or_cache = prev_outs.len(),
        from_rpc = missing.len(),
        "Resolving previous outputs"
    );

    if !missing.is_empty() {
        let fetched: Vec<Result<Transaction>> = stream::iter(missing)
            .map(|txid| async move { rpc.get_prev_transaction(&txid).await })
            .buffer_unordered(fetch_concurrency.max(1))
            .collect()
            .await;

        let mut cache = cache.lock().expect("prev-out cache poisoned");
        for result in fetched {
            let tx = result.map_err(|e| {
                SyncerError::Sync(format!("Failed to fetch previous transaction: {}", e))
            })?;
            let outs = prev_outs_of(&tx);
            cache.insert(tx.txid.clone(), outs.clone());
            prev_outs.insert(tx.txid, outs);
        }
    }

    Ok(PreparedBatch { blocks, prev_outs })
}

/// All rows produced by a batch, aggregated so that each table is written with
/// one statement (or a few chunked ones) instead of one statement per event.
#[derive(Default)]
struct BatchRows {
    blocks: Vec<BlockRow>,
    transactions: Vec<TransactionRow>,
    tx_index: HashMap<String, usize>,
    addresses: HashMap<String, AddressDelta>,
    assets: HashMap<String, AssetUpsert>,
    asset_events: Vec<AssetEventRow>,
    address_assets: HashMap<(String, String), i128>,
    /// (txid, address) -> what the address received/spent in that tx.
    tx_addresses: HashMap<(String, String), TxAddressRow>,
    /// (txid, address, asset) -> asset units moved.
    tx_address_assets: HashMap<(String, String, String), TxAddressAssetRow>,
}

impl BatchRows {
    fn address(&mut self, address: &str) -> &mut AddressDelta {
        if !self.addresses.contains_key(address) {
            self.addresses
                .insert(address.to_string(), AddressDelta::default());
        }
        self.addresses.get_mut(address).expect("just inserted")
    }

    fn address_asset(&mut self, address: &str, asset_name: &str, delta_sats: i128) {
        *self
            .address_assets
            .entry((address.to_string(), asset_name.to_string()))
            .or_insert(0) += delta_sats;
    }

    /// An issuance/reissuance output: folded into the `assets` row and kept
    /// as an event so the row can be rebuilt after a rollback.
    fn asset_event(&mut self, event: AssetUpsert, txid: &str, vout_n: u32, tx_index: usize) {
        self.asset_events.push(AssetEventRow {
            txid: txid.to_string(),
            vout_n: vout_n as i32,
            block_height: event.block_height,
            tx_index: tx_index as i32,
            event: event.clone(),
        });
        match self.assets.get_mut(&event.name) {
            Some(existing) => existing.merge(event),
            None => {
                self.assets.insert(event.name.clone(), event);
            }
        }
    }

    /// History row for (tx, address); created on first use.
    fn tx_address(&mut self, txid: &str, address: &str, block: &Block) -> &mut TxAddressRow {
        self.tx_addresses
            .entry((txid.to_string(), address.to_string()))
            .or_insert_with(|| TxAddressRow {
                txid: txid.to_string(),
                address: address.to_string(),
                block_height: block.height as i32,
                time: block.time as i32,
                received: 0,
                sent: 0,
            })
    }

    fn tx_address_asset(
        &mut self,
        txid: &str,
        address: &str,
        asset_name: &str,
        delta_sats: i128,
        block: &Block,
    ) {
        self.tx_address_assets
            .entry((txid.to_string(), address.to_string(), asset_name.to_string()))
            .or_insert_with(|| TxAddressAssetRow {
                txid: txid.to_string(),
                address: address.to_string(),
                asset_name: asset_name.to_string(),
                delta: 0,
                block_height: block.height as i32,
            })
            .delta += delta_sats;
    }

    fn transaction(&mut self, row: TransactionRow) {
        match self.tx_index.get(&row.txid) {
            // Same txid twice in a batch: the later one wins, as with upserts.
            Some(&idx) => self.transactions[idx] = row,
            None => {
                self.tx_index.insert(row.txid.clone(), self.transactions.len());
                self.transactions.push(row);
            }
        }
    }

    /// `addresses.tx_count` counts distinct transactions, i.e. `tx_addresses`
    /// rows. Also guarantees an `addresses` row for every address that only
    /// moved assets (needed by the foreign keys).
    fn count_transactions_per_address(&mut self) {
        let addresses: Vec<String> = self
            .tx_addresses
            .keys()
            .map(|(_, address)| address.clone())
            .collect();
        for address in addresses {
            self.address(&address).tx_count += 1;
        }
    }
}

pub struct BatchWriter<'a> {
    pool: &'a DbPool,
    async_commit: bool,
}

impl<'a> BatchWriter<'a> {
    pub fn new(pool: &'a DbPool, async_commit: bool) -> Self {
        Self { pool, async_commit }
    }

    /// Index a batch of blocks and advance the sync state, all in one database
    /// transaction.
    pub async fn write(&self, batch: &PreparedBatch) -> Result<()> {
        let rows = Self::build_rows(batch)?;
        let last_height = batch.last().height;

        let mut db_tx = self.pool.begin().await?;

        if self.async_commit {
            // The batch and the sync state are committed atomically, so losing
            // the last few commits on a crash only means re-syncing those
            // blocks; the database can never be left inconsistent.
            sqlx::query("SET LOCAL synchronous_commit TO OFF")
                .execute(&mut *db_tx)
                .await?;
        }

        // Order matters for the foreign keys:
        // transactions -> blocks; tx_addresses -> transactions/addresses;
        // address_assets, tx_address_assets -> addresses/assets.
        for chunk in rows.blocks.chunks(STATEMENT_CHUNK_ROWS) {
            BlocksRepository::insert_many_tx(&mut db_tx, chunk).await?;
        }
        for chunk in rows.transactions.chunks(STATEMENT_CHUNK_ROWS) {
            TransactionsRepository::insert_many_tx(&mut db_tx, chunk).await?;
        }

        let addresses: Vec<(String, AddressDelta)> = rows.addresses.into_iter().collect();
        for chunk in addresses.chunks(STATEMENT_CHUNK_ROWS) {
            AddressesRepository::apply_deltas_tx(&mut db_tx, chunk).await?;
        }

        let assets: Vec<AssetUpsert> = rows.assets.into_values().collect();
        for chunk in assets.chunks(STATEMENT_CHUNK_ROWS) {
            AssetsRepository::upsert_many_tx(&mut db_tx, chunk).await?;
        }
        for chunk in rows.asset_events.chunks(STATEMENT_CHUNK_ROWS) {
            AssetEventsRepository::insert_many_tx(&mut db_tx, chunk).await?;
        }

        let address_assets: Vec<AddressAssetDelta> = rows
            .address_assets
            .into_iter()
            .map(|((address, asset_name), balance)| AddressAssetDelta {
                address,
                asset_name,
                balance,
            })
            .collect();
        for chunk in address_assets.chunks(STATEMENT_CHUNK_ROWS) {
            AddressAssetsRepository::apply_deltas_tx(&mut db_tx, chunk).await?;
        }

        let tx_addresses: Vec<TxAddressRow> = rows.tx_addresses.into_values().collect();
        for chunk in tx_addresses.chunks(STATEMENT_CHUNK_ROWS) {
            TxAddressesRepository::insert_many_tx(&mut db_tx, chunk).await?;
        }

        let tx_address_assets: Vec<TxAddressAssetRow> =
            rows.tx_address_assets.into_values().collect();
        for chunk in tx_address_assets.chunks(STATEMENT_CHUNK_ROWS) {
            TxAddressAssetsRepository::insert_many_tx(&mut db_tx, chunk).await?;
        }

        SyncStateRepository::set_last_height_tx(&mut db_tx, last_height).await?;

        db_tx.commit().await?;

        Ok(())
    }

    fn build_rows(batch: &PreparedBatch) -> Result<BatchRows> {
        let mut rows = BatchRows::default();

        for block in &batch.blocks {
            rows.blocks.push(BlockRow::from_block(block)?);

            for (tx_index, transaction) in block.tx.iter().enumerate() {
                let (mut enriched, input_total) =
                    Self::process_inputs(&mut rows, transaction, block, &batch.prev_outs)?;

                // The serialized bytes go to their own column, not the JSON.
                let raw_hex = enriched.hex.take().and_then(|h| decode_hex(&h));

                let output_total = transaction.total_output().sats() as i128;
                // Exact fee in satoshis; None if some input value is unknown.
                let fee = input_total.map(|inputs| sats_to_decimal(inputs - output_total));

                rows.transaction(TransactionRow {
                    txid: transaction.txid.clone(),
                    block_height: block.height as i32,
                    tx_index: tx_index as i32,
                    time: block.time as i32,
                    total_output: sats_to_decimal(output_total),
                    fee,
                    raw_data: serde_json::to_value(&enriched)?,
                    raw_hex,
                });

                Self::process_outputs(&mut rows, transaction, tx_index, block);
            }
        }

        rows.count_transactions_per_address();

        Ok(rows)
    }

    /// Debit the owners of the spent outputs and return the transaction with
    /// its inputs enriched with address and value, plus the total value of
    /// its inputs in satoshis (`Some(0)` for coinbase, `None` if the value of
    /// some input could not be determined).
    fn process_inputs(
        rows: &mut BatchRows,
        transaction: &Transaction,
        block: &Block,
        prev_outs: &HashMap<String, PrevOuts>,
    ) -> Result<(Transaction, Option<i128>)> {
        let mut enriched = transaction.clone();
        // Coinbase transactions have no inputs to sum: their "fee" is 0 by
        // definition (the subsidy is not a fee), so start from the outputs.
        let is_coinbase = transaction.vin.iter().any(|v| v.is_coinbase());
        let mut input_total: Option<i128> = if is_coinbase {
            Some(transaction.total_output().sats() as i128)
        } else {
            Some(0)
        };

        for (i, vin) in transaction.vin.iter().enumerate() {
            if vin.is_coinbase() {
                continue;
            }

            let (txid, vout_idx) = match (&vin.txid, vin.vout) {
                (Some(t), Some(v)) => (t, v as usize),
                _ => {
                    input_total = None;
                    continue;
                }
            };

            let outs = prev_outs.get(txid).ok_or_else(|| {
                SyncerError::Sync(format!(
                    "Previous transaction {} not resolved for input {}:{}",
                    txid, transaction.txid, i
                ))
            })?;

            let prev_out = match outs.get(vout_idx) {
                Some(out) => out,
                None => {
                    input_total = None;
                    continue;
                }
            };

            let val = prev_out.value;
            let sats = val.sats() as i128;
            if let Some(total) = input_total.as_mut() {
                *total += sats;
            }

            // Outputs without an address (non-standard scripts) still count
            // for the fee, but there is nobody to debit.
            let addr = match &prev_out.address {
                Some(a) => a,
                None => continue,
            };

            enriched.vin[i].addresses = Some(vec![addr.clone()]);
            enriched.vin[i].value = Some(val);

            // Standard XNA debit
            if val.is_positive() {
                rows.address(addr).debit(sats);
                rows.tx_address(&transaction.txid, addr, block).sent += sats;
            }

            // Asset debit (independent of val: asset outputs carry 0 XNA)
            if let Some((ref name, amount)) = prev_out.asset {
                let asset_sats = amount.sats() as i128;
                rows.address_asset(addr, name, -asset_sats);
                rows.tx_address_asset(&transaction.txid, addr, name, -asset_sats, block);
            }

            // Index for history
            if val.is_positive() || prev_out.asset.is_some() {
                rows.tx_address(&transaction.txid, addr, block);
            }
        }

        Ok((enriched, input_total))
    }

    /// Credit the receivers of the outputs and register issued assets.
    fn process_outputs(
        rows: &mut BatchRows,
        transaction: &Transaction,
        tx_index: usize,
        block: &Block,
    ) {
        for vout in &transaction.vout {
            let addr = match vout.script_pub_key.first_address() {
                Some(a) => a,
                None => continue,
            };

            let val = vout.value;
            let sats = val.sats() as i128;

            if !val.is_negative() {
                // Standard XNA credit
                rows.address(addr).credit(sats);
                rows.tx_address(&transaction.txid, addr, block).received += sats;

                if let Some(ref asset) = vout.script_pub_key.asset {
                    let script_type = &vout.script_pub_key.script_type;
                    let asset_sats = asset.amount.sats() as i128;

                    // Register new/updated asset metadata
                    if script_type == "new_asset" || script_type == "reissue_asset" {
                        rows.asset_event(
                            AssetUpsert::from_event(asset, script_type, block.height, &transaction.txid),
                            &transaction.txid,
                            vout.n,
                            tx_index,
                        );
                    }

                    // Credit user balance
                    rows.address_asset(addr, &asset.name, asset_sats);
                    rows.tx_address_asset(&transaction.txid, addr, &asset.name, asset_sats, block);
                }
            }
        }
    }
}
