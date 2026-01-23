use thiserror::Error;

#[derive(Error, Debug)]
pub enum SyncerError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("RPC error: {0}")]
    Rpc(String),

    #[error("RPC call '{method}' failed: {message} (code: {code})")]
    RpcCall {
        method: String,
        code: i32,
        message: String,
    },

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Sync error: {0}")]
    Sync(String),

    #[error("Block not found: height {0}")]
    BlockNotFound(i64),

    #[error("Transaction not found: {0}")]
    TransactionNotFound(String),

    #[error("Reorg detected at height {0}")]
    ReorgDetected(i64),
}

pub type Result<T> = std::result::Result<T, SyncerError>;
