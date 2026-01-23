use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::watch;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::db::repositories::MempoolRepository;
use crate::db::DbPool;
use crate::error::Result;
use crate::rpc::RpcClient;

use super::run_interval_loop;

pub struct MempoolSync {
    config: Arc<Config>,
    rpc: Arc<RpcClient>,
    pool: DbPool,
    shutdown_rx: watch::Receiver<bool>,
}

impl MempoolSync {
    pub fn new(
        config: Arc<Config>,
        rpc: Arc<RpcClient>,
        pool: DbPool,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Self {
        Self {
            config,
            rpc,
            pool,
            shutdown_rx,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        info!("Starting mempool sync");

        run_interval_loop(
            &self.shutdown_rx,
            self.config.sync.mempool_interval,
            || async { self.sync_mempool().await },
            "Failed to sync mempool",
            "Shutdown signal received, stopping mempool sync",
        )
        .await
    }

    async fn sync_mempool(&self) -> Result<()> {
        debug!("Syncing mempool");

        // Get current mempool from node
        let node_txids: HashSet<String> = self.rpc.get_raw_mempool().await?.into_iter().collect();

        // Get current mempool from database
        let db_txids: HashSet<String> = MempoolRepository::get_all_txids(&self.pool)
            .await?
            .into_iter()
            .collect();

        // Find transactions to add (in node but not in db)
        let to_add: Vec<_> = node_txids.difference(&db_txids).collect();

        // Find transactions to remove (in db but not in node - confirmed or dropped)
        let to_remove: Vec<_> = db_txids.difference(&node_txids).collect();

        // Add new transactions
        for txid in to_add {
            match self.rpc.get_raw_transaction(txid).await {
                Ok(tx) => {
                    if let Err(e) = MempoolRepository::upsert(&self.pool, &tx).await {
                        warn!(txid = txid, error = %e, "Failed to add mempool tx");
                    }
                }
                Err(e) => {
                    warn!(txid = txid, error = %e, "Failed to fetch mempool tx");
                }
            }
        }

        // Remove old transactions
        for txid in to_remove {
            if let Err(e) = MempoolRepository::delete(&self.pool, txid).await {
                warn!(txid = txid, error = %e, "Failed to remove mempool tx");
            }
        }

        debug!(
            node_count = node_txids.len(),
            db_count = db_txids.len(),
            "Mempool synced"
        );

        Ok(())
    }
}
