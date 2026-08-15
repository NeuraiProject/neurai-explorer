use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use reqwest::Client;
use tracing::{debug, info, warn};

use crate::config::RpcConfig;
use crate::error::{Result, SyncerError};
use crate::types::{Block, MiningInfo, NetworkInfo, PeerInfo, Transaction, TxOutSetInfo};
use super::types::{RpcRequest, RpcResponse};

pub struct RpcClient {
    client: Client,
    url: String,
    /// Base URL of the node's REST interface (`-rest=1`), when it is enabled
    /// and reachable. Blocks and transactions are fetched through it: unlike
    /// the `getblock`/`getrawtransaction` RPCs, which hold the node's main
    /// lock for the whole call (JSON serialization included), the REST
    /// handlers only lock while reading from disk, so concurrent requests
    /// really run in parallel. It also bypasses the RPC work queue.
    rest_url: Option<String>,
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

        let rest_url = if config.use_rest {
            Some(format!("http://{}:{}/rest", config.host, config.port))
        } else {
            None
        };

        Ok(Self {
            client,
            url,
            rest_url,
            request_id: AtomicU64::new(0),
        })
    }

    /// Check that the REST interface answers; otherwise fall back to RPC for
    /// everything. Call once at startup, before sharing the client.
    pub async fn detect_rest(&mut self) {
        let Some(base) = self.rest_url.clone() else {
            info!("REST interface disabled by configuration, using RPC only");
            return;
        };

        let probe = self
            .client
            .get(format!("{}/chaininfo.json", base))
            .send()
            .await;

        match probe {
            Ok(resp) if resp.status().is_success() => {
                info!(url = %base, "Node REST interface detected, using it for blocks and transactions");
            }
            Ok(resp) => {
                warn!(
                    status = %resp.status(),
                    "Node REST interface not available (start the node with -rest=1 for faster sync), using RPC only"
                );
                self.rest_url = None;
            }
            Err(e) => {
                warn!(error = %e, "Node REST interface not reachable, using RPC only");
                self.rest_url = None;
            }
        }
    }

    pub fn uses_rest(&self) -> bool {
        self.rest_url.is_some()
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

        Self::log_duration(method, start);

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

    async fn rest_get<T: serde::de::DeserializeOwned>(&self, base: &str, path: &str) -> Result<T> {
        let start = std::time::Instant::now();
        let url = format!("{}/{}", base, path);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SyncerError::Rpc(format!("REST request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(SyncerError::Rpc(format!(
                "REST {} returned {}: {}",
                path,
                status,
                body.trim()
            )));
        }

        let value: T = response
            .json()
            .await
            .map_err(|e| SyncerError::Rpc(format!("Failed to parse REST response: {}", e)))?;

        Self::log_duration(path, start);
        Ok(value)
    }

    fn log_duration(what: &str, start: std::time::Instant) {
        let duration = start.elapsed();
        if duration.as_millis() > 5000 {
            warn!(call = what, duration_ms = %duration.as_millis(), "Slow node call");
        } else {
            debug!(call = what, duration_ms = %duration.as_millis(), "Node call completed");
        }
    }

    // Block methods
    pub async fn get_block_count(&self) -> Result<i64> {
        self.call("getblockcount", vec![]).await
    }

    pub async fn get_block_hash(&self, height: i64) -> Result<String> {
        self.call("getblockhash", vec![height.into()]).await
    }

    /// Block with full transaction details (`getblock` verbosity 2).
    pub async fn get_block(&self, hash: &str) -> Result<Block> {
        match &self.rest_url {
            Some(base) => self.rest_get(base, &format!("block/{}.json", hash)).await,
            None => self.call("getblock", vec![hash.into(), 2.into()]).await,
        }
    }

    pub async fn get_block_by_height(&self, height: i64) -> Result<Block> {
        let hash = self.get_block_hash(height).await?;
        self.get_block(&hash).await
    }

    // Transaction methods

    /// `getrawtransaction` verbose output. With `-spentindex` the node adds
    /// `address`/`value` to the inputs, which is why the mempool sync keeps
    /// using RPC here.
    pub async fn get_raw_transaction(&self, txid: &str) -> Result<Transaction> {
        self.call("getrawtransaction", vec![txid.into(), 1.into()]).await
    }

    /// A previously confirmed transaction, fetched only for its outputs while
    /// resolving the inputs of newer blocks. Uses REST when available.
    pub async fn get_prev_transaction(&self, txid: &str) -> Result<Transaction> {
        match &self.rest_url {
            Some(base) => self.rest_get(base, &format!("tx/{}.json", txid)).await,
            None => self.get_raw_transaction(txid).await,
        }
    }

    pub async fn get_raw_mempool(&self) -> Result<Vec<String>> {
        self.call("getrawmempool", vec![]).await
    }

    // Network methods
    pub async fn get_mining_info(&self) -> Result<MiningInfo> {
        self.call("getmininginfo", vec![]).await
    }

    pub async fn get_network_info(&self) -> Result<NetworkInfo> {
        self.call("getnetworkinfo", vec![]).await
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

#[cfg(test)]
mod tests {
    use crate::types::{Block, Transaction};

    // Real mainnet responses captured from a v1.0.5 node, so that a change in
    // the node's JSON shape (REST or RPC) is caught here.
    const REST_BLOCK: &str = include_str!("fixtures/rest_block_1700003.json");
    const REST_TX: &str = include_str!("fixtures/rest_tx_ce52fe3b.json");
    const RPC_TX: &str = include_str!("fixtures/rpc_getrawtransaction_ce52fe3b.json");

    #[test]
    fn rest_block_deserializes_with_full_transactions() {
        let block: Block = serde_json::from_str(REST_BLOCK).expect("REST block json");
        assert_eq!(block.height, 1700003);
        assert_eq!(block.tx.len(), 2);
        assert!(block.previousblockhash.is_some());
        assert!(block.tx[0].vin[0].is_coinbase());
        let spend = &block.tx[1];
        assert_eq!(spend.txid, "ce52fe3bd5e3f0dd388d5260a367d1c68a33cedab12c5cad95f72b536b1ade0d");
        assert!(spend.vin[0].txid.is_some() && spend.vin[0].vout.is_some());
        assert!(spend.vout[0].script_pub_key.addresses.as_ref().is_some_and(|a| !a.is_empty()));
    }

    #[test]
    fn rest_and_rpc_transaction_outputs_agree() {
        let rest: Transaction = serde_json::from_str(REST_TX).expect("REST tx json");
        let rpc: Transaction = serde_json::from_str(RPC_TX).expect("RPC tx json");
        assert_eq!(rest.txid, rpc.txid);
        assert_eq!(rest.vout.len(), rpc.vout.len());
        for (a, b) in rest.vout.iter().zip(rpc.vout.iter()) {
            assert_eq!(a.value, b.value);
            assert_eq!(a.script_pub_key.addresses, b.script_pub_key.addresses);
            assert_eq!(a.script_pub_key.asset.is_some(), b.script_pub_key.asset.is_some());
        }
        // Only the RPC form carries the spentindex input enrichment.
        assert!(rpc.vin[0].value.is_some());
        assert!(rest.vin[0].value.is_none());
    }
}
