use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiningInfo {
    pub blocks: i64,
    pub difficulty: f64,
    pub networkhashps: f64,
    pub pooledtx: i32,
    pub chain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub id: i64,
    pub addr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addrbind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addrlocal: Option<String>,
    pub services: String,
    pub relaytxes: bool,
    pub lastsend: i64,
    pub lastrecv: i64,
    pub bytessent: i64,
    pub bytesrecv: i64,
    pub conntime: i64,
    pub timeoffset: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pingtime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minping: Option<f64>,
    pub version: i64,
    pub subver: String,
    pub inbound: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addnode: Option<bool>,
    pub startingheight: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banscore: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_headers: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_blocks: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inflight: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whitelisted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxOutSetInfo {
    pub height: i64,
    pub bestblock: String,
    pub transactions: i64,
    pub txouts: i64,
    pub bogosize: i64,
    pub hash_serialized_2: String,
    pub disk_size: i64,
    pub total_amount: f64,
}
