use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use reqwest::Client;
use tracing::{debug, info, warn};

use crate::config::RpcConfig;
use crate::error::{Result, SyncerError};
use crate::types::{Block, MiningInfo, NetworkInfo, PeerInfo, Transaction, TxOutSetInfo};
use super::types::{RpcRequest, RpcResponse};

/// Longest single wait between attempts, even if the node asks for more via
/// `Retry-After`.
const MAX_RETRY_WAIT: Duration = Duration::from_secs(5);

pub struct RpcClient {
    client: Client,
    url: String,
    /// Attempts per request for retryable errors (>= 1).
    max_attempts: u32,
    /// Base delay of the exponential backoff.
    retry_delay: Duration,
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
            max_attempts: config.retries.max(1),
            retry_delay: Duration::from_millis(config.retry_delay_ms),
            rest_url,
            request_id: AtomicU64::new(0),
        })
    }

    /// Run `attempt` until it succeeds, it fails with a non-retryable error,
    /// or the attempts are exhausted. Backoff doubles from `retry_delay`
    /// with +-50% jitter (so concurrent requests do not retry in lockstep)
    /// and honours a `Retry-After` of up to `MAX_RETRY_WAIT`.
    async fn with_retries<T, F, Fut>(&self, what: &str, mut attempt: F) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut n = 1;
        loop {
            match attempt().await {
                Ok(value) => return Ok(value),
                Err(e) if e.is_retryable() && n < self.max_attempts => {
                    let retry_after = match &e {
                        SyncerError::Http { retry_after_secs: Some(secs), .. } => {
                            Some(Duration::from_secs(*secs))
                        }
                        _ => None,
                    };
                    let wait = self.backoff(n, retry_after);
                    warn!(
                        call = what,
                        attempt = n,
                        max_attempts = self.max_attempts,
                        wait_ms = wait.as_millis() as u64,
                        error = %e,
                        "Node request failed, retrying"
                    );
                    tokio::time::sleep(wait).await;
                    n += 1;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// Delay before attempt `n + 1`: `retry_delay * 2^(n-1)`, jittered by
    /// +-50%, at least `retry_after` when the node asked for it, capped.
    fn backoff(&self, n: u32, retry_after: Option<Duration>) -> Duration {
        let base = self.retry_delay.saturating_mul(1u32 << (n - 1).min(6));
        let jitter = jitter_factor(self.request_id.fetch_add(1, Ordering::Relaxed));
        let mut wait = base.mul_f64(jitter);
        if let Some(ra) = retry_after {
            wait = wait.max(ra);
        }
        wait.min(MAX_RETRY_WAIT)
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
        self.with_retries(method, || self.call_once(method, params.clone()))
            .await
    }

    /// One JSON-RPC round trip. Errors are classified before parsing:
    /// transport -> `Transport`; non-2xx with a JSON-RPC error object
    /// (bitcoind answers 404/500 for those) -> `RpcCall`; non-2xx without
    /// one (work queue full, auth, proxy...) -> `Http`.
    async fn call_once<T: serde::de::DeserializeOwned>(
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
            .map_err(|e| SyncerError::Transport(format!("{} ({})", e, method)))?;

        let status = response.status();
        let retry_after = retry_after_of(&response);
        let body = response
            .bytes()
            .await
            .map_err(|e| SyncerError::Transport(format!("reading response of {}: {}", method, e)))?;

        let parsed: std::result::Result<RpcResponse<T>, _> = serde_json::from_slice(&body);

        match parsed {
            Ok(rpc_response) => {
                Self::log_duration(method, start);
                if let Some(error) = rpc_response.error {
                    return Err(SyncerError::RpcCall {
                        method: method.to_string(),
                        code: error.code,
                        message: error.message,
                    });
                }
                match rpc_response.result {
                    Some(value) => Ok(value),
                    None => Err(SyncerError::Rpc(format!(
                        "RPC call '{}' returned null result",
                        method
                    ))),
                }
            }
            Err(_) if !status.is_success() => Err(SyncerError::Http {
                status: status.as_u16(),
                body: format!(
                    "{} ({})",
                    String::from_utf8_lossy(&body).trim().chars().take(200).collect::<String>(),
                    method
                ),
                retry_after_secs: retry_after,
            }),
            Err(parse_err) => Err(SyncerError::Rpc(format!(
                "Failed to parse response of '{}': {}",
                method, parse_err
            ))),
        }
    }

    async fn rest_get<T: serde::de::DeserializeOwned>(&self, base: &str, path: &str) -> Result<T> {
        self.with_retries(path, || self.rest_get_once(base, path)).await
    }

    async fn rest_get_once<T: serde::de::DeserializeOwned>(
        &self,
        base: &str,
        path: &str,
    ) -> Result<T> {
        let start = std::time::Instant::now();
        let url = format!("{}/{}", base, path);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SyncerError::Transport(format!("{} (REST {})", e, path)))?;

        let status = response.status();
        let retry_after = retry_after_of(&response);
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(SyncerError::Http {
                status: status.as_u16(),
                body: format!(
                    "{} (REST {})",
                    body.trim().chars().take(200).collect::<String>(),
                    path
                ),
                retry_after_secs: retry_after,
            });
        }

        let value: T = response
            .json()
            .await
            .map_err(|e| SyncerError::Rpc(format!("Failed to parse REST response of {}: {}", path, e)))?;

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

/// `Retry-After` header in seconds, if present and numeric.
fn retry_after_of(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

/// Multiplier in [0.5, 1.5) derived from a counter, so that concurrent
/// requests spread their retries without a random number generator.
fn jitter_factor(seed: u64) -> f64 {
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(0x6A09_E667_F3BC_C909);
    x ^= x >> 29;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 32;
    0.5 + (x % 1000) as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn retryable_classification() {
        assert!(SyncerError::Transport("timeout".into()).is_retryable());
        let http = |status: u16| SyncerError::Http { status, body: String::new(), retry_after_secs: None };
        assert!(http(500).is_retryable()); // e.g. "Work queue depth exceeded"
        assert!(http(503).is_retryable());
        assert!(http(429).is_retryable());
        assert!(!http(404).is_retryable());
        assert!(!http(401).is_retryable());
        assert!(!SyncerError::RpcCall { method: "getblockhash".into(), code: -8, message: "out of range".into() }.is_retryable());
        assert!(!SyncerError::Rpc("parse".into()).is_retryable());
    }

    #[test]
    fn backoff_grows_with_jitter_and_is_capped() {
        let cfg = crate::config::RpcConfig {
            user: "u".into(), pass: "p".into(), host: "h".into(), port: 1, timeout: 1000,
            use_rest: false, retries: 3, retry_delay_ms: 200,
        };
        let client = RpcClient::new(&cfg).unwrap();
        for n in 1..=3 {
            let base = 200u128 << (n - 1);
            let w = client.backoff(n, None).as_millis();
            assert!(w >= base / 2 && w < base * 3 / 2, "attempt {} wait {}ms not within +-50% of {}", n, w, base);
        }
        // Retry-After wins over the backoff, but never beyond the cap
        assert_eq!(client.backoff(1, Some(Duration::from_secs(2))), Duration::from_secs(2));
        assert_eq!(client.backoff(1, Some(Duration::from_secs(60))), MAX_RETRY_WAIT);
        // Deterministic spread
        let f: Vec<f64> = (0..5).map(jitter_factor).collect();
        assert!(f.iter().all(|x| (0.5..1.5).contains(x)));
        assert!(f.windows(2).any(|w| w[0] != w[1]));
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
