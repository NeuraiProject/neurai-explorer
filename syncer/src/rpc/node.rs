use async_trait::async_trait;

use super::RpcClient;
use crate::error::Result;
use crate::types::{Block, Transaction};

/// What the sync engine needs from a node. Implemented by `RpcClient`
/// (JSON-RPC/REST) and by an in-memory mock in tests, so that block
/// fetching, reorg detection and rollback can be exercised without a node.
#[async_trait]
pub trait NodeClient: Send + Sync + 'static {
    async fn get_block_count(&self) -> Result<i64>;
    async fn get_block_hash(&self, height: i64) -> Result<String>;
    /// Block with full transaction details.
    async fn get_block_by_height(&self, height: i64) -> Result<Block>;
    /// A confirmed transaction, fetched for its outputs.
    async fn get_prev_transaction(&self, txid: &str) -> Result<Transaction>;
}

// Fully qualified calls: the inherent methods have the same names.
#[async_trait]
impl NodeClient for RpcClient {
    async fn get_block_count(&self) -> Result<i64> {
        RpcClient::get_block_count(self).await
    }
    async fn get_block_hash(&self, height: i64) -> Result<String> {
        RpcClient::get_block_hash(self, height).await
    }
    async fn get_block_by_height(&self, height: i64) -> Result<Block> {
        RpcClient::get_block_by_height(self, height).await
    }
    async fn get_prev_transaction(&self, txid: &str) -> Result<Transaction> {
        RpcClient::get_prev_transaction(self, txid).await
    }
}
