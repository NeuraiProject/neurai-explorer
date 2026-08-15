use thiserror::Error;

#[derive(Error, Debug)]
pub enum SyncerError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("RPC error: {0}")]
    Rpc(String),

    /// Could not reach the node or the connection broke (timeout, refused,
    /// reset). Retryable.
    #[error("Node unreachable: {0}")]
    Transport(String),

    /// The node's HTTP server answered with a non-success status and no
    /// JSON-RPC error object (e.g. 500 "Work queue depth exceeded", 429,
    /// REST 404). Retryable for 5xx / 429 only.
    #[error("Node HTTP {status}: {body}")]
    Http {
        status: u16,
        body: String,
        /// `Retry-After` header, in seconds, if the node sent one.
        retry_after_secs: Option<u64>,
    },

    #[error("RPC call '{method}' failed: {message} (code: {code})")]
    RpcCall {
        method: String,
        code: i32,
        message: String,
    },

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("HTTP client error: {0}")]
    HttpClient(#[from] reqwest::Error),

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

impl SyncerError {
    /// Whether retrying the same node request a moment later can succeed:
    /// transport failures, server-side overload/errors (5xx) and rate limiting
    /// (429). Client errors (4xx), JSON-RPC errors and anything else are
    /// deterministic and are not retried.
    pub fn is_retryable(&self) -> bool {
        match self {
            SyncerError::Transport(_) => true,
            SyncerError::Http { status, .. } => *status >= 500 || *status == 429,
            _ => false,
        }
    }
}
