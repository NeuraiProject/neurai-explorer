mod config;
mod db;
mod error;
mod rpc;
mod sync;
mod types;

use std::sync::Arc;
use tokio::signal;
use tokio::sync::watch;
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::Config;
use crate::db::create_pool;
use crate::error::Result;
use crate::rpc::RpcClient;
use crate::sync::{rollback_from_height, DailyStatsSync, MempoolSync, PriceSync, StatsSync, SyncEngine};

/// Command line: `neurai-syncer` runs the syncer; `neurai-syncer --rollback
/// <height>` undoes blocks >= height (as after a reorg) and exits.
enum Command {
    Run,
    Rollback(i64),
}

fn parse_args() -> std::result::Result<Command, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => Ok(Command::Run),
        [flag, height] if flag == "--rollback" => height
            .parse::<i64>()
            .map(Command::Rollback)
            .map_err(|_| format!("invalid height '{}'", height)),
        _ => Err("usage: neurai-syncer [--rollback <height>]".to_string()),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    init_logging();

    let command = parse_args().map_err(crate::error::SyncerError::Config)?;

    info!("Neurai Syncer v3.2.0 (Rust) starting...");

    // Load configuration
    let config = Arc::new(Config::load("config.json")?);
    info!(
        rpc_host = config.rpc.host,
        db_host = config.database.host,
        "Configuration loaded"
    );

    // Create database pool
    let pool = create_pool(&config.database).await?;

    if let Command::Rollback(height) = command {
        info!(height, "Rolling back blocks >= height (operator request)");
        let report = rollback_from_height(&pool, height).await?;
        info!(%report, "Done; start the syncer normally to resync from there");
        pool.close().await;
        return Ok(());
    }

    // Create RPC client
    let mut rpc = RpcClient::new(&config.rpc)?;

    // Wait for the node: right after `docker compose up` it is still loading
    // its indexes (or in -reindex) and refuses RPC for a while.
    let block_count = wait_for_node(&rpc).await;
    info!(block_count, "Connected to node");

    // Use the node's REST interface for block/tx fetches when available
    rpc.detect_rest().await;
    info!(rest = rpc.uses_rest(), retries = config.rpc.retries, "Node client ready");
    let rpc = Arc::new(rpc);

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Spawn sync tasks
    let mut handles = Vec::new();

    // Block sync engine
    {
        let config = Arc::clone(&config);
        let rpc = Arc::clone(&rpc);
        let pool = pool.clone();
        let shutdown_rx = shutdown_rx.clone();

        handles.push(tokio::spawn(async move {
            let mut engine = SyncEngine::new(config, rpc, pool, shutdown_rx);
            if let Err(e) = engine.run().await {
                error!(error = %e, "Sync engine error");
            }
        }));
    }

    // Network stats sync
    {
        let config = Arc::clone(&config);
        let rpc = Arc::clone(&rpc);
        let pool = pool.clone();
        let shutdown_rx = shutdown_rx.clone();

        handles.push(tokio::spawn(async move {
            let mut stats = StatsSync::new(config, rpc, pool, shutdown_rx);
            if let Err(e) = stats.run().await {
                error!(error = %e, "Stats sync error");
            }
        }));
    }

    // Mempool sync
    {
        let config = Arc::clone(&config);
        let rpc = Arc::clone(&rpc);
        let pool = pool.clone();
        let shutdown_rx = shutdown_rx.clone();

        handles.push(tokio::spawn(async move {
            let mut mempool = MempoolSync::new(config, rpc, pool, shutdown_rx);
            if let Err(e) = mempool.run().await {
                error!(error = %e, "Mempool sync error");
            }
        }));
    }

    // Daily stats sync
    {
        let config = Arc::clone(&config);
        let pool = pool.clone();
        let shutdown_rx = shutdown_rx.clone();

        handles.push(tokio::spawn(async move {
            let mut stats = DailyStatsSync::new(config, pool, shutdown_rx);
            if let Err(e) = stats.run().await {
                error!(error = %e, "Daily stats sync error");
            }
        }));
    }

    // Price sync
    {
        let config = Arc::clone(&config);
        let pool = pool.clone();
        let shutdown_rx = shutdown_rx.clone();

        handles.push(tokio::spawn(async move {
            let mut price = PriceSync::new(config, pool, shutdown_rx);
            if let Err(e) = price.run().await {
                error!(error = %e, "Price sync error");
            }
        }));
    }

    // Wait for shutdown signal
    info!("Syncer running. Press Ctrl+C to stop.");
    shutdown_signal().await;

    // Send shutdown signal to all tasks
    info!("Initiating graceful shutdown...");
    let _ = shutdown_tx.send(true);

    // Wait for all tasks to complete
    for handle in handles {
        let _ = handle.await;
    }

    // Close database pool
    pool.close().await;

    info!("Shutdown complete");
    Ok(())
}

/// Poll `getblockcount` until the node answers. Waits forever (the process is
/// stopped by SIGTERM/Ctrl+C in the meantime), logging every attempt so the
/// operator sees why the syncer has not started yet.
async fn wait_for_node(rpc: &RpcClient) -> i64 {
    let mut attempt: u32 = 0;
    loop {
        match rpc.get_block_count().await {
            Ok(count) => return count,
            Err(e) => {
                attempt += 1;
                let wait_secs = std::cmp::min(30, 5 * attempt as u64);
                warn!(
                    attempt,
                    error = %e,
                    "Node not ready, retrying in {}s (RPC warmup / reindex, or check RPC_HOST/RPC_USER/RPC_PASS)",
                    wait_secs
                );
                tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
            }
        }
    }
}

fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,reqwest=warn"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true))
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("Shutdown signal received");
}
