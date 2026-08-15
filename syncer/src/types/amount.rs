use std::fmt;
use std::str::FromStr;

use bigdecimal::BigDecimal;
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Number of decimals of XNA and asset amounts.
pub const AMOUNT_DECIMALS: u32 = 8;
const SATS_PER_UNIT: i64 = 100_000_000;

/// An XNA or asset amount in satoshi units (1e-8), parsed exactly from the
/// node's JSON literal instead of going through an `f64`.
///
/// The node always prints amounts as plain decimals (`50000.00000000`,
/// `1060.2358`, `21000000000.12345678`); those are parsed digit by digit.
/// When the value arrives as a float (e.g. rebuilt from a `serde_json::Value`
/// or an exotic literal), it is rounded to 8 decimals, which is what the
/// previous `f64` code did.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Amount(i64);

impl Amount {
    #[cfg(test)]
    pub const fn from_sats(sats: i64) -> Self {
        Amount(sats)
    }

    pub const fn sats(self) -> i64 {
        self.0
    }

    pub fn is_positive(self) -> bool {
        self.0 > 0
    }

    pub fn is_negative(self) -> bool {
        self.0 < 0
    }

    /// Exact decimal with 8 fractional digits.
    pub fn to_decimal(self) -> BigDecimal {
        BigDecimal::new(self.0.into(), AMOUNT_DECIMALS as i64)
    }

    /// Nearest amount to an `f64`, rounding to 8 decimals.
    pub fn from_f64_lossy(value: f64) -> Self {
        Amount((value * SATS_PER_UNIT as f64).round() as i64)
    }

    /// The decimal literal the node would print (`123.45600000`).
    pub fn to_literal(self) -> String {
        let abs = self.0.unsigned_abs();
        format!(
            "{}{}.{:08}",
            if self.0 < 0 { "-" } else { "" },
            abs / SATS_PER_UNIT as u64,
            abs % SATS_PER_UNIT as u64
        )
    }

    /// Parse a plain decimal literal exactly; anything else (exponents) goes
    /// through `BigDecimal` and is rounded to 8 decimals.
    pub fn parse(text: &str) -> Result<Self, String> {
        let text = text.trim();
        let (negative, digits) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text.strip_prefix('+').unwrap_or(text)),
        };

        if digits.is_empty() {
            return Err("empty amount".to_string());
        }

        let (int_part, frac_part) = digits.split_once('.').unwrap_or((digits, ""));
        let plain = (int_part.is_empty() || int_part.bytes().all(|b| b.is_ascii_digit()))
            && frac_part.bytes().all(|b| b.is_ascii_digit())
            && frac_part.len() <= AMOUNT_DECIMALS as usize
            && !(int_part.is_empty() && frac_part.is_empty());

        let sats: i64 = if plain {
            let whole: i64 = if int_part.is_empty() {
                0
            } else {
                int_part
                    .parse::<i64>()
                    .map_err(|e| format!("invalid amount '{}': {}", text, e))?
            };
            let frac: i64 = if frac_part.is_empty() {
                0
            } else {
                frac_part.parse::<i64>().map_err(|e| format!("invalid amount '{}': {}", text, e))?
                    * 10i64.pow(AMOUNT_DECIMALS - frac_part.len() as u32)
            };
            whole
                .checked_mul(SATS_PER_UNIT)
                .and_then(|w| w.checked_add(frac))
                .ok_or_else(|| format!("amount out of range: {}", text))?
        } else {
            let decimal = BigDecimal::from_str(digits)
                .map_err(|e| format!("invalid amount '{}': {}", text, e))?;
            let scaled = (decimal * BigDecimal::from(SATS_PER_UNIT))
                .with_scale_round(0, bigdecimal::RoundingMode::HalfUp);
            let (int, _) = scaled.into_bigint_and_exponent();
            i64::try_from(int).map_err(|_| format!("amount out of range: {}", text))?
        };

        Ok(Amount(if negative { -sats } else { sats }))
    }
}

impl fmt::Debug for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Amount({})", self.to_literal())
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_literal())
    }
}

impl std::ops::Neg for Amount {
    type Output = Amount;
    fn neg(self) -> Amount {
        Amount(-self.0)
    }
}

impl std::ops::Add for Amount {
    type Output = Amount;
    fn add(self, rhs: Amount) -> Amount {
        Amount(self.0 + rhs.0)
    }
}

impl std::ops::AddAssign for Amount {
    fn add_assign(&mut self, rhs: Amount) {
        self.0 += rhs.0;
    }
}

impl std::iter::Sum for Amount {
    fn sum<I: Iterator<Item = Amount>>(iter: I) -> Amount {
        Amount(iter.map(|a| a.0).sum())
    }
}

impl Serialize for Amount {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Emitted as a JSON number with the exact literal, e.g. 50000.00000000
        serde_json::Number::from_str(&self.to_literal())
            .map_err(serde::ser::Error::custom)?
            .serialize(serializer)
    }
}

struct AmountVisitor;

impl<'de> Visitor<'de> for AmountVisitor {
    type Value = Amount;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a decimal amount")
    }

    // With serde_json's arbitrary_precision feature a number arrives here as
    // a one-entry map holding the original literal; serde_json::Number knows
    // how to read it.
    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Amount, A::Error> {
        let number = serde_json::Number::deserialize(de::value::MapAccessDeserializer::new(map))?;
        Amount::parse(&number.to_string()).map_err(de::Error::custom)
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Amount, E> {
        if !v.is_finite() {
            return Err(E::custom("non-finite amount"));
        }
        Ok(Amount::from_f64_lossy(v))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Amount, E> {
        i64::try_from(v)
            .ok()
            .and_then(|v| v.checked_mul(SATS_PER_UNIT))
            .map(Amount)
            .ok_or_else(|| E::custom("amount out of range"))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Amount, E> {
        v.checked_mul(SATS_PER_UNIT)
            .map(Amount)
            .ok_or_else(|| E::custom("amount out of range"))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Amount, E> {
        Amount::parse(v).map_err(E::custom)
    }
}

impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Amount, D::Error> {
        deserializer.deserialize_any(AmountVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_literals_exactly() {
        assert_eq!(Amount::parse("50000.00000000").unwrap().sats(), 5_000_000_000_000);
        assert_eq!(Amount::parse("50000").unwrap().sats(), 5_000_000_000_000);
        assert_eq!(Amount::parse("1060.2358").unwrap().sats(), 106_023_580_000);
        assert_eq!(Amount::parse("0.00000001").unwrap().sats(), 1);
        assert_eq!(Amount::parse("-0.5").unwrap().sats(), -50_000_000);
        // 18 significant digits: not representable as f64
        assert_eq!(Amount::parse("21000000000.12345678").unwrap().sats(), 2_100_000_000_012_345_678);
        assert_eq!(Amount::parse("1e-8").unwrap().sats(), 1);
        assert!(Amount::parse("0.123456789").is_err() || Amount::parse("0.123456789").unwrap().sats() == 12_345_679);
        assert!(Amount::parse("abc").is_err());
    }

    #[test]
    fn json_round_trip_keeps_the_literal() {
        #[derive(Serialize, Deserialize)]
        struct Out {
            value: Amount,
        }
        let out: Out = serde_json::from_str(r#"{"value":21000000000.12345678}"#).unwrap();
        assert_eq!(out.value.sats(), 2_100_000_000_012_345_678);
        assert_eq!(serde_json::to_string(&out).unwrap(), r#"{"value":21000000000.12345678}"#);

        let out: Out = serde_json::from_str(r#"{"value":50000}"#).unwrap();
        assert_eq!(serde_json::to_string(&out).unwrap(), r#"{"value":50000.00000000}"#);

        // Values rebuilt from a serde_json::Value go through f64: rounded to 8 decimals
        let out: Out = serde_json::from_value(serde_json::json!({"value": 0.1})).unwrap();
        assert_eq!(out.value.sats(), 10_000_000);
        let out: Out = serde_json::from_value(serde_json::json!({"value": 50000})).unwrap();
        assert_eq!(out.value.sats(), 5_000_000_000_000);
    }

    #[test]
    fn decimal_and_literal_forms() {
        let a = Amount::from_sats(123_456_712_345_678);
        assert_eq!(a.to_literal(), "1234567.12345678");
        assert_eq!(a.to_decimal().to_string(), "1234567.12345678");
        assert_eq!(Amount::from_sats(-1).to_literal(), "-0.00000001");
        assert_eq!(Amount::from_f64_lossy(0.1).sats(), 10_000_000);
    }
}
