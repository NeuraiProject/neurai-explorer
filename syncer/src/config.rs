use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::error::SyncerError;

#[derive(Debug, Clone)]
pub struct Config {
    pub rpc: RpcConfig,
    pub database: DatabaseConfig,
    pub sync: SyncConfig,
    pub api: ApiConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigFile {
    #[serde(default)]
    pub rpc: RpcConfigFile,
    #[serde(default)]
    pub database: DatabaseConfigFile,
    pub sync: SyncConfig,
    pub api: ApiConfig,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RpcConfigFile {
    pub user: Option<String>,
    pub pass: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub timeout: Option<u64>,
    pub use_rest: Option<bool>,
    pub retries: Option<u32>,
    pub retry_delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct DatabaseConfigFile {
    pub user: Option<String>,
    pub pass: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RpcConfig {
    pub user: String,
    pub pass: String,
    pub host: String,
    pub port: u16,
    pub timeout: u64,
    /// Fetch blocks and transactions through the node's REST interface
    /// (`-rest=1`) when it is available. Falls back to RPC automatically.
    pub use_rest: bool,
    /// Attempts per node request for retryable failures (transport, 5xx,
    /// 429). 1 = no retries.
    pub retries: u32,
    /// Base delay between attempts; doubles each time, with jitter.
    pub retry_delay_ms: u64,
}

fn default_rpc_timeout() -> u64 {
    120000
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub user: String,
    pub pass: String,
    pub host: String,
    pub port: u16,
    pub name: String,
}

fn default_db_port() -> u16 {
    5432
}

impl DatabaseConfig {
    pub fn connection_string(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            self.user, self.pass, self.host, self.port, self.name
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    #[serde(default = "default_network_stats_interval")]
    pub network_stats_interval: u64,
    #[serde(default = "default_mempool_interval")]
    pub mempool_interval: u64,
    #[serde(default = "default_daily_stats_interval")]
    pub daily_stats_interval: u64,
    #[serde(default = "default_main_loop_new_block_wait")]
    pub main_loop_new_block_wait: u64,
    #[serde(default = "default_main_loop_error_wait")]
    pub main_loop_error_wait: u64,
    /// Blocks fetched and written per database transaction.
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    /// Concurrent `getblock` requests while fetching a batch.
    #[serde(default = "default_block_fetch_concurrency")]
    pub block_fetch_concurrency: usize,
    /// Concurrent `getrawtransaction` requests while resolving inputs.
    #[serde(default = "default_input_fetch_concurrency")]
    pub input_fetch_concurrency: usize,
    /// Batches fetched ahead of the database writer.
    #[serde(default = "default_prefetch_batches")]
    pub prefetch_batches: usize,
    /// Commit batches with `synchronous_commit = off` (no fsync wait). Safe:
    /// data and sync state are committed atomically, a crash only re-syncs
    /// the last blocks.
    #[serde(default = "default_async_commit")]
    pub async_commit: bool,
    /// Interval for the expensive `gettxoutsetinfo` (supply) call, which
    /// scans the whole UTXO set on the node.
    #[serde(default = "default_supply_interval")]
    pub supply_interval: u64,
    /// When the database is at least this many blocks behind the tip, the
    /// syncer enters "bulk mode": secondary indexes with random keys are
    /// dropped and autovacuum paused on the big tables until it gets within
    /// this distance again, when they are rebuilt. 0 disables it.
    #[serde(default = "default_bulk_mode_threshold")]
    pub bulk_mode_threshold: i64,
    /// `maintenance_work_mem` used while rebuilding the deferred indexes.
    #[serde(default = "default_index_build_mem")]
    pub index_build_mem: String,
}

fn default_network_stats_interval() -> u64 {
    5000
}

fn default_mempool_interval() -> u64 {
    10000
}

fn default_daily_stats_interval() -> u64 {
    60000
}

fn default_main_loop_new_block_wait() -> u64 {
    10000
}

fn default_main_loop_error_wait() -> u64 {
    5000
}

fn default_batch_size() -> usize {
    250
}

fn default_block_fetch_concurrency() -> usize {
    16
}

fn default_input_fetch_concurrency() -> usize {
    32
}

fn default_prefetch_batches() -> usize {
    2
}

fn default_async_commit() -> bool {
    true
}

fn default_supply_interval() -> u64 {
    600000
}

fn default_bulk_mode_threshold() -> i64 {
    20_000
}

fn default_index_build_mem() -> String {
    "512MB".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConfig {
    pub coingecko_url: String,
    #[serde(default = "default_price_fetch_interval")]
    pub price_fetch_interval: u64,
}

fn default_price_fetch_interval() -> u64 {
    3600000
}

impl Config {
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, SyncerError> {
        let content = fs::read_to_string(path.as_ref()).map_err(|e| {
            SyncerError::Config(format!(
                "Failed to read config file at {:?}: {}",
                path.as_ref(),
                e
            ))
        })?;

        let mut config_file: ConfigFile = serde_json::from_str(&content).map_err(|e| {
            SyncerError::Config(format!("Failed to parse config JSON: {}", e))
        })?;

        config_file.apply_env_overrides();

        let rpc = RpcConfig::from_raw(config_file.rpc)?;
        let database = DatabaseConfig::from_raw(config_file.database)?;

        Ok(Config {
            rpc,
            database,
            sync: config_file.sync,
            api: config_file.api,
        })
    }
}

impl ConfigFile {
    fn apply_env_overrides(&mut self) {
        if let Ok(user) = std::env::var("RPC_USER") {
            self.rpc.user = Some(user);
        }
        if let Ok(pass) = std::env::var("RPC_PASS") {
            self.rpc.pass = Some(pass);
        }
        if let Ok(host) = std::env::var("RPC_HOST") {
            self.rpc.host = Some(host);
        }
        if let Ok(port) = std::env::var("RPC_PORT") {
            if let Ok(port) = port.parse() {
                self.rpc.port = Some(port);
            }
        }
        if let Ok(timeout) = std::env::var("RPC_TIMEOUT") {
            if let Ok(timeout) = timeout.parse() {
                self.rpc.timeout = Some(timeout);
            }
        }
        if let Ok(use_rest) = std::env::var("RPC_USE_REST") {
            self.rpc.use_rest = Some(matches!(
                use_rest.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            ));
        }
        if let Ok(retries) = std::env::var("RPC_RETRIES") {
            if let Ok(retries) = retries.parse() {
                self.rpc.retries = Some(retries);
            }
        }
        if let Ok(delay) = std::env::var("RPC_RETRY_DELAY_MS") {
            if let Ok(delay) = delay.parse() {
                self.rpc.retry_delay_ms = Some(delay);
            }
        }

        if let Ok(url) = std::env::var("DATABASE_URL") {
            if let Some(parsed) = Self::parse_database_url(&url) {
                self.database = parsed;
            }
        }
    }

    fn parse_database_url(url: &str) -> Option<DatabaseConfigFile> {
        let url = url
            .strip_prefix("postgres://")
            .or_else(|| url.strip_prefix("postgresql://"))?;
        let (auth, rest) = url.split_once('@')?;
        let (user, pass) = auth.split_once(':')?;
        let (host_port, name) = rest.split_once('/')?;
        let (host, port) = host_port
            .split_once(':')
            .map(|(h, p)| (h, p.parse().ok()))
            .unwrap_or((host_port, None));

        Some(DatabaseConfigFile {
            user: Some(user.to_string()),
            pass: Some(pass.to_string()),
            host: Some(host.to_string()),
            port,
            name: Some(name.to_string()),
        })
    }
}

impl RpcConfig {
    fn from_raw(raw: RpcConfigFile) -> Result<Self, SyncerError> {
        let user = raw.user.ok_or_else(|| {
            SyncerError::Config("RPC_USER is required (set via environment)".to_string())
        })?;
        let pass = raw.pass.ok_or_else(|| {
            SyncerError::Config("RPC_PASS is required (set via environment)".to_string())
        })?;
        let host = raw.host.ok_or_else(|| {
            SyncerError::Config("RPC_HOST is required (set via environment)".to_string())
        })?;
        let port = raw.port.unwrap_or(19001);
        let timeout = raw.timeout.unwrap_or_else(default_rpc_timeout);
        let use_rest = raw.use_rest.unwrap_or(true);
        let retries = raw.retries.unwrap_or(3).max(1);
        let retry_delay_ms = raw.retry_delay_ms.unwrap_or(200);

        Ok(RpcConfig {
            user,
            pass,
            host,
            port,
            timeout,
            use_rest,
            retries,
            retry_delay_ms,
        })
    }
}

impl DatabaseConfig {
    fn from_raw(raw: DatabaseConfigFile) -> Result<Self, SyncerError> {
        let user = raw.user.ok_or_else(|| {
            SyncerError::Config(
                "DATABASE_URL (or database.user) is required (set via environment)".to_string(),
            )
        })?;
        let pass = raw.pass.ok_or_else(|| {
            SyncerError::Config(
                "DATABASE_URL (or database.pass) is required (set via environment)".to_string(),
            )
        })?;
        let host = raw.host.ok_or_else(|| {
            SyncerError::Config(
                "DATABASE_URL (or database.host) is required (set via environment)".to_string(),
            )
        })?;
        let name = raw.name.ok_or_else(|| {
            SyncerError::Config(
                "DATABASE_URL (or database.name) is required (set via environment)".to_string(),
            )
        })?;
        let port = raw.port.unwrap_or_else(default_db_port);

        Ok(DatabaseConfig {
            user,
            pass,
            host,
            port,
            name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_database_url() {
        let url = "postgres://user:pass@localhost:5432/testdb";
        let config = ConfigFile::parse_database_url(url).unwrap();
        assert_eq!(config.user.as_deref(), Some("user"));
        assert_eq!(config.pass.as_deref(), Some("pass"));
        assert_eq!(config.host.as_deref(), Some("localhost"));
        assert_eq!(config.port, Some(5432));
        assert_eq!(config.name.as_deref(), Some("testdb"));
    }

    #[test]
    fn test_parse_database_url_postgresql() {
        let url = "postgresql://user:pass@localhost:5432/testdb";
        let config = ConfigFile::parse_database_url(url).unwrap();
        assert_eq!(config.user.as_deref(), Some("user"));
        assert_eq!(config.pass.as_deref(), Some("pass"));
        assert_eq!(config.host.as_deref(), Some("localhost"));
        assert_eq!(config.port, Some(5432));
        assert_eq!(config.name.as_deref(), Some("testdb"));
    }
}
