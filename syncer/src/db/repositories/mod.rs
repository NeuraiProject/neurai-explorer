mod blocks;
mod transactions;
mod addresses;
mod assets;
mod sync_state;
mod network_stats;
mod mempool;
mod daily_stats;

pub use blocks::{BlockRow, BlocksRepository};
pub use transactions::{TransactionRow, TransactionsRepository};
pub use addresses::{AddressDelta, AddressesRepository, TxAddressRow, TxAddressesRepository};
pub use assets::{
    AddressAssetDelta, AddressAssetsRepository, AssetEventRow, AssetEventsRepository, AssetUpsert,
    AssetsRepository, TxAddressAssetRow, TxAddressAssetsRepository,
};
pub use sync_state::SyncStateRepository;
pub use network_stats::NetworkStatsRepository;
pub use mempool::MempoolRepository;
pub use daily_stats::DailyStatsRepository;

use bigdecimal::BigDecimal;

use crate::types::AMOUNT_DECIMALS;

/// Convert an amount in satoshi units (1e-8) to a NUMERIC with 8 decimals.
///
/// Amounts are accumulated as integers so that additions are exact; only the
/// final value is turned into a decimal for storage.
pub(crate) fn sats_to_decimal(sats: i128) -> BigDecimal {
    BigDecimal::new(sats.into(), AMOUNT_DECIMALS as i64)
}

/// Convert an f64 (difficulty, hashrate, price...) to a NUMERIC using its
/// shortest round-trip decimal representation (e.g. `0.1` -> `0.1`), instead
/// of the exact binary expansion `BigDecimal::try_from(f64)` would produce
/// (`0.1000000000000000055511151231257827...`).
pub(crate) fn to_decimal(value: f64) -> BigDecimal {
    if !value.is_finite() {
        return BigDecimal::default();
    }
    value
        .to_string()
        .parse::<BigDecimal>()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sats_to_decimal_is_exact() {
        assert_eq!(sats_to_decimal(10_000_000), "0.1".parse::<BigDecimal>().unwrap());
        assert_eq!(sats_to_decimal(-1), "-0.00000001".parse::<BigDecimal>().unwrap());
        assert_eq!(sats_to_decimal(123_456_712_345_678).to_string(), "1234567.12345678");
    }

    #[test]
    fn to_decimal_uses_shortest_representation() {
        assert_eq!(to_decimal(0.1).to_string(), "0.1");
        assert_eq!(to_decimal(658.7317092323935).to_string(), "658.7317092323935");
        assert_eq!(to_decimal(f64::NAN).to_string(), "0");
    }
}
