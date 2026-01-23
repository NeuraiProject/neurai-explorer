use std::sync::Arc;

use chrono::NaiveDate;
use tokio::sync::watch;
use tracing::{error, info};

use crate::config::Config;
use crate::db::repositories::DailyStatsRepository;
use crate::db::DbPool;
use crate::error::Result;

use super::run_interval_loop;

pub struct DailyStatsSync {
    config: Arc<Config>,
    pool: DbPool,
    shutdown_rx: watch::Receiver<bool>,
}

impl DailyStatsSync {
    pub fn new(
        config: Arc<Config>,
        pool: DbPool,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Self {
        Self {
            config,
            pool,
            shutdown_rx,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        info!("Starting daily stats sync");

        if let Err(e) = self.aggregate().await {
            error!(error = %e, "Failed to sync daily stats");
        }

        run_interval_loop(
            &self.shutdown_rx,
            self.config.sync.daily_stats_interval,
            || async { self.aggregate().await },
            "Failed to sync daily stats",
            "Shutdown signal received, stopping daily stats sync",
        )
        .await
    }

    async fn aggregate(&self) -> Result<()> {
        let last_date = DailyStatsRepository::latest_date(&self.pool).await?;
        let start_date = last_date.unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap());
        DailyStatsRepository::aggregate_from_date(&self.pool, start_date).await?;
        Ok(())
    }
}
