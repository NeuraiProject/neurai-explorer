mod engine;
mod processor;
mod cache;
mod stats;
mod mempool;
mod daily_stats;

pub use engine::SyncEngine;
pub use stats::StatsSync;
pub use stats::PriceSync;
pub use mempool::MempoolSync;
pub use daily_stats::DailyStatsSync;

use std::future::Future;
use tokio::sync::watch;
use tokio::time::{sleep, Duration};
use tracing::{error, info};

use crate::error::Result;

pub async fn run_interval_loop<F, Fut>(
    shutdown_rx: &watch::Receiver<bool>,
    interval_ms: u64,
    mut tick: F,
    error_msg: &'static str,
    shutdown_msg: &'static str,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    loop {
        if *shutdown_rx.borrow() {
            info!("{}", shutdown_msg);
            break;
        }

        if let Err(e) = tick().await {
            error!(error = %e, "{}", error_msg);
        }

        sleep(Duration::from_millis(interval_ms)).await;
    }

    Ok(())
}
