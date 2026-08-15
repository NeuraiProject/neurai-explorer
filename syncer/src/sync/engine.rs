use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures::stream::{self, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use crate::config::Config;
use crate::db::repositories::{BlocksRepository, SyncStateRepository};
use crate::db::DbPool;
use crate::error::{Result, SyncerError};
use crate::rpc::NodeClient;
use crate::types::Block;

use super::cache::PrevOutCache;
use super::processor::{prepare_batch, BatchWriter, PreparedBatch};

/// Number of previous transactions kept in memory. Entries are small (only
/// address/value/asset per output), so this is tens of MB at most.
const PREV_OUT_CACHE_CAPACITY: usize = 200_000;

/// When the database is within this many blocks of the chain tip, the hashes
/// of the last `REORG_CHECK_DEPTH` stored blocks are compared with the node
/// before syncing. Further from the tip, the `previousblockhash` link of every
/// batch is enough to detect a fork and is free.
const NEAR_TIP_WINDOW: i64 = 100;
const REORG_CHECK_DEPTH: i64 = 10;

/// Deepest fork the syncer will roll back on its own.
const MAX_REORG_DEPTH: i64 = 1_000;

pub struct SyncEngine<C: NodeClient> {
    config: Arc<Config>,
    rpc: Arc<C>,
    pool: DbPool,
    shutdown_rx: watch::Receiver<bool>,
    prev_out_cache: Arc<Mutex<PrevOutCache>>,
}

impl<C: NodeClient> SyncEngine<C> {
    pub fn new(
        config: Arc<Config>,
        rpc: Arc<C>,
        pool: DbPool,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Self {
        Self {
            config,
            rpc,
            pool,
            shutdown_rx,
            prev_out_cache: Arc::new(Mutex::new(PrevOutCache::new(PREV_OUT_CACHE_CAPACITY))),
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        info!(
            batch_size = self.config.sync.batch_size,
            block_fetch_concurrency = self.config.sync.block_fetch_concurrency,
            input_fetch_concurrency = self.config.sync.input_fetch_concurrency,
            prefetch_batches = self.config.sync.prefetch_batches,
            async_commit = self.config.sync.async_commit,
            "Starting sync engine"
        );

        loop {
            if *self.shutdown_rx.borrow() {
                info!("Shutdown signal received, stopping sync engine");
                break;
            }

            match self.step().await {
                Ok(true) => {}
                Ok(false) => {
                    // No new blocks, wait before checking again
                    let wait_ms = self.config.sync.main_loop_new_block_wait;
                    self.sleep_or_shutdown(wait_ms).await;
                }
                Err(e) => {
                    error!(error = %e, "Sync iteration failed");
                    let wait_ms = self.config.sync.main_loop_error_wait;
                    self.sleep_or_shutdown(wait_ms).await;
                }
            }
        }

        Ok(())
    }

    /// One unit of work: sync up to the current tip, or roll back a detected
    /// fork so the next step can resync from it. `Ok(false)` = nothing to do.
    pub(crate) async fn step(&mut self) -> Result<bool> {
        match self.sync_iteration().await {
            Err(SyncerError::ReorgDetected(height)) => {
                warn!(height, "Chain fork detected, rolling back");
                self.resolve_reorg(height).await?;
                Ok(true)
            }
            other => other,
        }
    }

    async fn sleep_or_shutdown(&mut self, wait_ms: u64) {
        tokio::select! {
            _ = sleep(Duration::from_millis(wait_ms)) => {}
            _ = self.shutdown_rx.changed() => {}
        }
    }

    /// Sync everything between the database height and the current chain tip.
    /// Returns `Ok(false)` when there was nothing to do.
    async fn sync_iteration(&self) -> Result<bool> {
        let chain_height = self.rpc.get_block_count().await?;
        let mut db_height = SyncStateRepository::get_last_height(&self.pool)
            .await?
            .unwrap_or(-1);

        // Bulk mode: far behind -> drop random-key secondary indexes and pause
        // autovacuum; close to the tip (or at it) -> rebuild them.
        self.update_bulk_mode(chain_height - db_height).await?;

        if db_height >= chain_height {
            return Ok(false);
        }

        // Near the tip a reorg may have replaced blocks we already stored;
        // compare the last few hashes with the node. Far from the tip the
        // per-batch previousblockhash check below catches the same thing.
        if db_height >= 0 && chain_height - db_height <= NEAR_TIP_WINDOW {
            if let Some(fork_height) = self.find_fork(db_height, REORG_CHECK_DEPTH).await? {
                self.rollback_from_height(fork_height).await?;
                db_height = fork_height - 1;
            }
        }

        let last_hash = if db_height >= 0 {
            BlocksRepository::get_by_height(&self.pool, db_height).await?
        } else {
            None
        };

        // Catching up over many blocks gets progress lines; at the tip a
        // single new block gets one line with its hash (see Progress).
        let behind = chain_height - db_height;
        let bulk = behind >= self.config.sync.batch_size as i64;
        if bulk {
            info!(from = db_height + 1, to = chain_height, behind, "Syncing blocks");
        }

        self.catch_up(db_height + 1, chain_height, last_hash, bulk).await?;

        Ok(true)
    }

    /// Enter/leave bulk mode according to how far behind the tip we are.
    async fn update_bulk_mode(&self, behind: i64) -> Result<()> {
        let threshold = self.config.sync.bulk_mode_threshold;
        if threshold <= 0 {
            return Ok(());
        }
        let active = crate::db::bulk::state(&self.pool).await?.is_some();
        if !active && behind >= threshold {
            info!(behind, threshold, "Far behind the tip: entering bulk mode");
            crate::db::bulk::enter(&self.pool).await?;
        } else if active && behind < threshold {
            info!(behind, threshold, "Close to the tip: leaving bulk mode");
            crate::db::bulk::exit(&self.pool, &self.config.sync.index_build_mem).await?;
        }
        Ok(())
    }

    /// Fetch blocks `from..=to` from the node in batches (in a background task,
    /// several batches ahead) and index each batch as soon as it is ready.
    async fn catch_up(
        &self,
        from: i64,
        to: i64,
        mut last_hash: Option<String>,
        bulk: bool,
    ) -> Result<()> {
        let sync_cfg = &self.config.sync;
        let batch_size = sync_cfg.batch_size.max(1) as i64;

        let (batch_tx, mut batch_rx) =
            mpsc::channel::<Result<PreparedBatch>>(sync_cfg.prefetch_batches.max(1));

        let fetcher = tokio::spawn(Self::fetch_loop(
            Arc::clone(&self.rpc),
            Arc::clone(&self.prev_out_cache),
            self.shutdown_rx.clone(),
            from,
            to,
            batch_size,
            sync_cfg.block_fetch_concurrency.max(1),
            sync_cfg.input_fetch_concurrency.max(1),
            batch_tx,
        ));

        let writer = BatchWriter::new(&self.pool, sync_cfg.async_commit);
        let mut progress = Progress::new(from, to, bulk);

        let result: Result<()> = async {
            while let Some(item) = batch_rx.recv().await {
                let batch = item?;

                // Every batch must extend the block we stored last.
                if let Some(ref expected) = last_hash {
                    let first = batch.first();
                    if first.previousblockhash.as_deref() != Some(expected.as_str()) {
                        return Err(SyncerError::ReorgDetected(first.height - 1));
                    }
                }

                let write_started = Instant::now();
                writer.write(&batch).await?;
                let write_ms = write_started.elapsed().as_millis() as u64;

                last_hash = Some(batch.last().hash.clone());
                progress.record(&batch, write_ms, &self.prev_out_cache);

                if *self.shutdown_rx.borrow() {
                    break;
                }
            }
            Ok(())
        }
        .await;

        // Stop the fetcher whether we finished, failed, or are shutting down.
        fetcher.abort();
        let _ = fetcher.await;

        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn fetch_loop(
        rpc: Arc<C>,
        cache: Arc<Mutex<PrevOutCache>>,
        shutdown_rx: watch::Receiver<bool>,
        from: i64,
        to: i64,
        batch_size: i64,
        block_concurrency: usize,
        input_concurrency: usize,
        out: mpsc::Sender<Result<PreparedBatch>>,
    ) {
        let mut start = from;
        while start <= to {
            if *shutdown_rx.borrow() {
                return;
            }

            let end = std::cmp::min(start + batch_size - 1, to);

            let prepared = async {
                let blocks = Self::fetch_blocks(rpc.as_ref(), start, end, block_concurrency).await?;
                prepare_batch(rpc.as_ref(), blocks, &cache, input_concurrency).await
            }
            .await;

            let failed = prepared.is_err();
            if out.send(prepared).await.is_err() {
                // Consumer is gone.
                return;
            }
            if failed {
                return;
            }

            start = end + 1;
        }
    }

    /// Fetch `from..=to` concurrently, returning the blocks in height order.
    async fn fetch_blocks(
        rpc: &C,
        from: i64,
        to: i64,
        concurrency: usize,
    ) -> Result<Vec<Block>> {
        let results: Vec<Result<Block>> = stream::iter(from..=to)
            .map(|height| async move { rpc.get_block_by_height(height).await })
            .buffered(concurrency)
            .collect()
            .await;

        results.into_iter().collect()
    }

    /// Roll back to the last block shared with the node's chain.
    async fn resolve_reorg(&self, suspected_height: i64) -> Result<()> {
        let db_height = SyncStateRepository::get_last_height(&self.pool)
            .await?
            .unwrap_or(-1);
        let depth = std::cmp::min(MAX_REORG_DEPTH, db_height + 1);

        match self.find_fork(db_height, depth).await? {
            Some(fork_height) => self.rollback_from_height(fork_height).await,
            None => Err(SyncerError::Sync(format!(
                "Fork detected below height {} but no divergence found in the last {} blocks",
                suspected_height, depth
            ))),
        }
    }

    /// Compare the hashes of the `depth` blocks ending at `db_height` with the
    /// node, walking backwards. Returns the lowest height whose stored hash
    /// differs from the chain, if any.
    async fn find_fork(&self, db_height: i64, depth: i64) -> Result<Option<i64>> {
        let mut fork_height = None;

        for i in 0..depth {
            let height = db_height - i;
            if height < 0 {
                break;
            }

            let db_hash = BlocksRepository::get_by_height(&self.pool, height).await?;
            let chain_hash = self.rpc.get_block_hash(height).await?;

            match db_hash {
                Some(ref db_h) if db_h != &chain_hash => {
                    warn!(height, db_hash = db_h, chain_hash, "Block hash mismatch");
                    fork_height = Some(height);
                }
                // Once the hashes agree, every block below agrees too.
                Some(_) => break,
                None => {}
            }
        }

        Ok(fork_height)
    }

    async fn rollback_from_height(&self, height: i64) -> Result<()> {
        info!(from_height = height, "Rolling back blocks due to reorg");
        super::rollback::rollback_from_height(&self.pool, height).await?;
        Ok(())
    }
}

/// Throughput bookkeeping for the progress log.
struct Progress {
    target: i64,
    started: Instant,
    start_height: i64,
    last_log: Instant,
    blocks_since_log: i64,
    txs_since_log: usize,
    /// Time spent writing batches to the database since the last log line.
    db_ms_since_log: u64,
    /// Bulk catch-up (throughput lines) vs. following the tip (one line per
    /// block).
    bulk: bool,
}

impl Progress {
    const LOG_EVERY: Duration = Duration::from_secs(10);

    fn new(from: i64, to: i64, bulk: bool) -> Self {
        let now = Instant::now();
        Self {
            target: to,
            started: now,
            start_height: from,
            last_log: now,
            blocks_since_log: 0,
            txs_since_log: 0,
            db_ms_since_log: 0,
            bulk,
        }
    }

    fn record(&mut self, batch: &PreparedBatch, write_ms: u64, cache: &Mutex<PrevOutCache>) {
        if !self.bulk {
            for block in &batch.blocks {
                info!(height = block.height, hash = %block.hash, txs = block.tx.len(), "New block");
            }
            return;
        }

        self.blocks_since_log += batch.blocks.len() as i64;
        self.txs_since_log += batch.tx_count();
        self.db_ms_since_log += write_ms;

        let height = batch.last().height;
        let done = height >= self.target;
        if !done && self.last_log.elapsed() < Self::LOG_EVERY {
            return;
        }

        let elapsed = self.last_log.elapsed().as_secs_f64().max(1e-6);
        let rate = self.blocks_since_log as f64 / elapsed;
        let overall = (height - self.start_height + 1) as f64
            / self.started.elapsed().as_secs_f64().max(1e-6);
        let remaining = self.target - height;
        let eta_secs = if overall > 0.0 {
            (remaining as f64 / overall) as u64
        } else {
            0
        };
        let cache_len = cache.lock().map(|c| c.len()).unwrap_or(0);
        // Share of wall time spent waiting for the database (the rest is
        // fetching from the node / waiting for the prefetcher).
        let db_pct = (self.db_ms_since_log as f64 / (elapsed * 1000.0) * 100.0).min(100.0);

        info!(
            height,
            target = self.target,
            remaining,
            blocks_per_sec = format!("{:.1}", rate),
            txs = self.txs_since_log,
            db_pct = format!("{:.0}%", db_pct),
            eta = format!("{}h{:02}m", eta_secs / 3600, (eta_secs % 3600) / 60),
            prev_out_cache = cache_len,
            "Sync progress"
        );

        self.last_log = Instant::now();
        self.blocks_since_log = 0;
        self.txs_since_log = 0;
        self.db_ms_since_log = 0;
    }
}
