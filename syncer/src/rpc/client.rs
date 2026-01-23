use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use reqwest::Client;
use tracing::{debug, warn};

use crate::config::RpcConfig;
use crate::error::{Result, SyncerError};
use crate::types::{Block, MiningInfo, PeerInfo, Transaction, TxOutSetInfo};
use super::types::{RpcRequest, RpcResponse};

pub struct RpcClient {
    client: Client,
    url: String,
    request_id: AtomicU64,
}

impl RpcClient {
    pub fn new(config: &RpcConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_millis(config.timeout))
            .build()
            .map_err(|e| SyncerError::Rpc(format!("Failed to create HTTP client: {}", e)))?;

        let url = format!(
            "http://{}:{}@{}:{}",
            config.user, config.pass, config.host, config.port
        );

        Ok(Self {
            client,
            url,
            request_id: AtomicU64::new(0),
        })
    }

    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<T> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let request = RpcRequest::new(format!("req-{}", id), method, params);

        let start = std::time::Instant::now();

        let response = self
            .client
            .post(&self.url)
            .json(&request)
            .send()
            .await
            .map_err(|e| SyncerError::Rpc(format!("HTTP request failed: {}", e)))?;

        let rpc_response: RpcResponse<T> = response
            .json()
            .await
            .map_err(|e| SyncerError::Rpc(format!("Failed to parse response: {}", e)))?;

        let duration = start.elapsed();
        if duration.as_millis() > 5000 {
            warn!(method = method, duration_ms = %duration.as_millis(), "Slow RPC call");
        } else {
            debug!(method = method, duration_ms = %duration.as_millis(), "RPC call completed");
        }

        if let Some(error) = rpc_response.error {
            return Err(SyncerError::RpcCall {
                method: method.to_string(),
                code: error.code,
                message: error.message,
            });
        }

        rpc_response.result.ok_or_else(|| {
            SyncerError::Rpc(format!("RPC call '{}' returned null result", method))
        })
    }

    // Block methods
    pub async fn get_block_count(&self) -> Result<i64> {
        self.call("getblockcount", vec![]).await
    }

    pub async fn get_block_hash(&self, height: i64) -> Result<String> {
        self.call("getblockhash", vec![height.into()]).await
    }

    pub async fn get_block(&self, hash: &str, verbosity: i32) -> Result<Block> {
        self.call("getblock", vec![hash.into(), verbosity.into()])
            .await
    }

    pub async fn get_block_by_height(&self, height: i64) -> Result<Block> {
        let hash = self.get_block_hash(height).await?;
        self.get_block(&hash, 2).await
    }

    // Transaction methods
    pub async fn get_raw_transaction(&self, txid: &str) -> Result<Transaction> {
        self.call("getrawtransaction", vec![txid.into(), 1.into()])
            .await
    }

    pub async fn get_raw_mempool(&self) -> Result<Vec<String>> {
        self.call("getrawmempool", vec![]).await
    }

    // Network methods
    pub async fn get_mining_info(&self) -> Result<MiningInfo> {
        self.call("getmininginfo", vec![]).await
    }

    pub async fn get_connection_count(&self) -> Result<i32> {
        self.call("getconnectioncount", vec![]).await
    }

    pub async fn get_peer_info(&self) -> Result<Vec<PeerInfo>> {
        self.call("getpeerinfo", vec![]).await
    }

    pub async fn get_tx_out_set_info(&self) -> Result<TxOutSetInfo> {
        self.call("gettxoutsetinfo", vec![]).await
    }
}
