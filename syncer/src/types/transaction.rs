use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::Amount;

/// Fields of the node's JSON that this struct does not model explicitly are
/// kept in `extra`, so they survive the round trip into `raw_data`
/// (`txinwitness`, `vrefin` from NIP-014, `valueSat`, ...).
pub type Extra = Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptSig {
    pub asm: String,
    pub hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub name: String,
    pub amount: Amount,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub units: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reissuable: Option<i32>,
    #[serde(rename = "hasIPFS", skip_serializing_if = "Option::is_none")]
    pub has_ipfs: Option<i32>,
    #[serde(rename = "ipfs_hash", skip_serializing_if = "Option::is_none")]
    pub ipfs_hash: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptPubKey {
    pub asm: String,
    pub hex: String,
    #[serde(rename = "reqSigs", skip_serializing_if = "Option::is_none")]
    pub req_sigs: Option<i32>,
    #[serde(rename = "type")]
    pub script_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addresses: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<Asset>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl ScriptPubKey {
    /// First address of the output script, if any.
    pub fn first_address(&self) -> Option<&str> {
        self.addresses
            .as_ref()
            .and_then(|a| a.first())
            .map(|s| s.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vin {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub txid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vout: Option<u32>,
    #[serde(rename = "scriptSig", skip_serializing_if = "Option::is_none")]
    pub script_sig: Option<ScriptSig>,
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coinbase: Option<String>,
    // Enriched fields (added during processing)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addresses: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Amount>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Vin {
    pub fn is_coinbase(&self) -> bool {
        self.coinbase.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vout {
    pub value: Amount,
    pub n: u32,
    #[serde(rename = "scriptPubKey")]
    pub script_pub_key: ScriptPubKey,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub txid: String,
    pub hash: String,
    pub version: i32,
    pub size: i32,
    pub vsize: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<i32>,
    pub locktime: u64,
    pub vin: Vec<Vin>,
    pub vout: Vec<Vout>,
    /// Serialized transaction. Stored in `transactions.raw_hex`, not in the
    /// JSON.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blockhash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmations: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocktime: Option<i64>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Transaction {
    pub fn total_output(&self) -> Amount {
        self.vout.iter().map(|v| v.value).sum()
    }
}

/// Decode a hex string into bytes. Returns `None` on odd length or a
/// non-hex character.
pub fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let bytes = hex.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks(2) {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_hex_works() {
        assert_eq!(decode_hex("00ff10"), Some(vec![0, 255, 16]));
        assert_eq!(decode_hex(""), Some(vec![]));
        assert_eq!(decode_hex("abc"), None);
        assert_eq!(decode_hex("zz"), None);
    }

    #[test]
    fn unknown_fields_are_preserved() {
        let json = r#"{"txid":"t","hash":"t","version":3,"size":1,"vsize":1,"locktime":0,
            "vin":[{"txid":"p","vout":0,"scriptSig":{"asm":"","hex":""},"sequence":1,"txinwitness":["aa"]}],
            "vout":[{"value":1.5,"n":0,"scriptPubKey":{"asm":"","hex":"","type":"pubkeyhash","addresses":["A"]},"valueSat":150000000}],
            "vrefin":[{"txid":"r","vout":1}]}"#;
        let tx: Transaction = serde_json::from_str(json).unwrap();
        assert_eq!(tx.vout[0].value.sats(), 150_000_000);
        let back = serde_json::to_value(&tx).unwrap();
        assert_eq!(back["vrefin"][0]["txid"], "r");
        assert_eq!(back["vin"][0]["txinwitness"][0], "aa");
        assert_eq!(back["vout"][0]["valueSat"], 150000000);
        // Modelled amounts come out as strings; unknown node fields (valueSat) as sent
        assert_eq!(back["vout"][0]["value"], "1.50000000");
    }
}
