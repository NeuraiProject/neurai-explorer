//! Integration tests for the batch writer. They need a PostgreSQL database:
//!
//! ```sh
//! TEST_DATABASE_URL=postgres://neurai:neurai123@127.0.0.1:55432/neuraidb \
//!     cargo test -- --ignored --test-threads=1
//! ```
//!
//! The database is wiped between tests.

use std::collections::HashMap;
use std::sync::Mutex;

use bigdecimal::BigDecimal;
use serde_json::json;
use sqlx::PgPool;

use super::cache::{prev_outs_of, PrevOutCache};
use super::processor::{BatchWriter, PreparedBatch};
use crate::types::Block;

fn coinbase_tx(txid: &str, outputs: Vec<serde_json::Value>) -> serde_json::Value {
    json!({
        "txid": txid, "hash": txid, "version": 1, "size": 100, "vsize": 100, "locktime": 0,
        "vin": [{"coinbase": "03abcdef", "sequence": 4294967295u64}],
        "vout": outputs,
        "hex": "00"
    })
}

fn tx(txid: &str, inputs: Vec<(&str, u32)>, outputs: Vec<serde_json::Value>) -> serde_json::Value {
    let vin: Vec<_> = inputs
        .into_iter()
        .map(|(prev, n)| json!({"txid": prev, "vout": n, "scriptSig": {"asm": "", "hex": ""}, "sequence": 4294967295u64}))
        .collect();
    json!({
        "txid": txid, "hash": txid, "version": 1, "size": 200, "vsize": 200, "locktime": 0,
        "vin": vin, "vout": outputs, "hex": "00"
    })
}

fn out(n: u32, value: f64, address: Option<&str>) -> serde_json::Value {
    let mut spk = json!({"asm": "", "hex": "", "type": if address.is_some() { "pubkeyhash" } else { "nulldata" }});
    if let Some(a) = address {
        spk["addresses"] = json!([a]);
    }
    json!({"value": value, "n": n, "scriptPubKey": spk})
}

fn asset_out(n: u32, address: &str, script_type: &str, name: &str, amount: f64, ipfs: Option<&str>) -> serde_json::Value {
    let mut asset = json!({"name": name, "amount": amount});
    if script_type != "transfer_asset" {
        asset["units"] = json!(0);
        asset["reissuable"] = json!(1);
        asset["hasIPFS"] = json!(if ipfs.is_some() { 1 } else { 0 });
        if let Some(h) = ipfs {
            asset["ipfs_hash"] = json!(h);
        }
    }
    json!({
        "value": 0.0, "n": n,
        "scriptPubKey": {"asm": "", "hex": "", "type": script_type, "addresses": [address], "asset": asset}
    })
}

/// Output whose value is given as the exact decimal literal the node would
/// print (json! would go through an f64 literal and lose digits above 2^53 sats).
fn out_exact(n: u32, value: &str, address: &str) -> serde_json::Value {
    let mut v = out(n, 0.0, Some(address));
    v["value"] = serde_json::Value::Number(value.parse().expect("decimal literal"));
    v
}

fn block(height: i64, prev: Option<&str>, txs: Vec<serde_json::Value>) -> Block {
    block_variant(height, prev, txs, 0)
}

/// Same as `block` but with a hash that also depends on `variant`, to build
/// competing versions of a height (reorgs).
fn block_variant(height: i64, prev: Option<&str>, txs: Vec<serde_json::Value>, variant: u32) -> Block {
    let mut b = json!({
        "hash": format!("{:056x}{:08x}", height + 1, variant),
        "height": height,
        "version": 1, "versionHex": "00000001", "merkleroot": "00",
        "time": 1_700_000_000 + height * 60, "mediantime": 1_700_000_000 + height * 60,
        "nonce": 0, "bits": "1d00ffff", "difficulty": 0.1, "chainwork": "00",
        "tx": txs, "size": 300, "strippedsize": 300, "weight": 1200
    });
    if let Some(p) = prev {
        b["previousblockhash"] = json!(p);
    }
    // Parse from text, like the real node responses: that is the exact path
    // for amounts (from_value would go through f64).
    serde_json::from_str(&b.to_string()).expect("valid block json")
}

/// A small chain exercising every code path of the writer:
/// - coinbase credits, spends with change, outputs without address
/// - the same address credited twice in one tx (tx_count counts events)
/// - asset issuance, reissue (same batch), transfer, and a 0-XNA asset spend
fn fixture_chain() -> Vec<Block> {
    let b0 = block(0, None, vec![coinbase_tx("c0", vec![out(0, 50000.0, Some("A"))])]);
    let b1 = block(1, Some(&b0.hash), vec![
        coinbase_tx("c1", vec![out(0, 50000.0, Some("B"))]),
        // A spends its 50000: 49999.5 to C, 0.4 change to A, 0.1 fee
        tx("t1", vec![("c0", 0)], vec![
            out(0, 49999.5, Some("C")),
            out(1, 0.4, Some("A")),
            out(2, 0.0, None), // OP_RETURN
        ]),
    ]);
    let b2 = block(2, Some(&b1.hash), vec![
        coinbase_tx("c2", vec![out(0, 50000.0, Some("B"))]),
        // C issues an asset (500 burned to B as "issuance fee", owner token to C)
        tx("t2", vec![("t1", 0)], vec![
            out(0, 500.0, Some("B")),
            out(1, 49499.4, Some("C")),
            asset_out(2, "C", "new_asset", "TOKEN", 1000.0, Some("QmHash1")),
            asset_out(3, "C", "new_asset", "TOKEN!", 1.0, None),
        ]),
        // C reissues 500 more, sends 250 to D, keeps 750 (asset outputs carry 0 XNA);
        // also pays B twice in the same tx.
        tx("t3", vec![("t2", 1), ("t2", 2), ("t2", 3)], vec![
            out(0, 49399.3, Some("C")),
            out(1, 50.0, Some("B")),
            out(2, 50.0, Some("B")),
            asset_out(3, "C", "reissue_asset", "TOKEN", 500.0, Some("QmHash2")),
            asset_out(4, "D", "transfer_asset", "TOKEN", 250.0, None),
            asset_out(5, "C", "transfer_asset", "TOKEN", 750.0, None),
            asset_out(6, "C", "transfer_asset", "TOKEN!", 1.0, None),
        ]),
    ]);
    let b3 = block(3, Some(&b2.hash), vec![
        coinbase_tx("c3", vec![out(0, 50000.0, Some("E"))]),
        // D spends its 0-XNA asset output (asset debit without XNA debit)
        tx("t4", vec![("t3", 4)], vec![
            asset_out(0, "E", "transfer_asset", "TOKEN", 250.0, None),
        ]),
    ]);
    vec![b0, b1, b2, b3]
}

fn prepare_offline(blocks: Vec<Block>) -> PreparedBatch {
    prepare_offline_with(blocks, &[])
}

/// Batch whose inputs may also spend outputs of `earlier` blocks (no RPC).
fn prepare_offline_with(blocks: Vec<Block>, earlier: &[Block]) -> PreparedBatch {
    let mut prev_outs = HashMap::new();
    for b in earlier.iter().chain(blocks.iter()) {
        for t in &b.tx {
            prev_outs.insert(t.txid.clone(), prev_outs_of(t));
        }
    }
    PreparedBatch { blocks, prev_outs }
}

async fn test_pool() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let pool = PgPool::connect(&url).await.expect("connect to TEST_DATABASE_URL");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");
    for table in ["asset_events", "tx_address_assets", "tx_addresses", "address_assets", "transactions", "blocks", "addresses", "assets", "sync_state"] {
        sqlx::query(&format!("TRUNCATE {} CASCADE", table)).execute(&pool).await.unwrap();
    }
    Some(pool)
}

/// Full v4 snapshot of the indexed data, as sorted (key, value) rows.
async fn snapshot(pool: &PgPool) -> Vec<(String, String)> {
    let mut rows = snapshot_legacy(pool, true).await;

    let ta: Vec<(String, String, BigDecimal, BigDecimal)> = sqlx::query_as(
        "SELECT txid, address, received, sent FROM tx_addresses ORDER BY txid, address",
    ).fetch_all(pool).await.unwrap();
    for (t, a, r, se) in ta {
        rows.push((format!("tx_addr_delta:{}:{}", t, a), format!("+{} -{}", n(&r), n(&se))));
    }
    let taa: Vec<(String, String, String, BigDecimal, i32)> = sqlx::query_as(
        "SELECT txid, address, asset_name, delta, block_height FROM tx_address_assets ORDER BY txid, address, asset_name",
    ).fetch_all(pool).await.unwrap();
    for (t, a, name, d, h) in taa {
        rows.push((format!("tx_addr_asset:{}:{}:{}", t, a, name), format!("{} {}", n(&d), h)));
    }
    let txs: Vec<(String, i32, Option<Vec<u8>>, serde_json::Value, Option<BigDecimal>)> = sqlx::query_as(
        "SELECT txid, tx_index, raw_hex, raw_data, fee FROM transactions ORDER BY txid",
    ).fetch_all(pool).await.unwrap();
    for (t, i, hex, raw, fee) in txs {
        rows.push((format!("tx_v4:{}", t), format!("idx={} hex={:?} json_hex={} fee={}", i, hex, raw.get("hex").is_some(),
            fee.map(|f| n(&f)).unwrap_or_else(|| "null".into()))));
    }
    let blocks: Vec<(i32, serde_json::Value)> = sqlx::query_as(
        "SELECT height, raw_data FROM blocks ORDER BY height",
    ).fetch_all(pool).await.unwrap();
    for (h, raw) in blocks {
        rows.push((format!("block_v4:{}", h), format!("tx={} size={}", raw["tx"], raw["size"])));
    }
    let events: Vec<(String, i32, String, i32, i32, String, BigDecimal, Option<String>)> = sqlx::query_as(
        "SELECT txid, vout_n, asset_name, block_height, tx_index, type, amount, ipfs_hash FROM asset_events ORDER BY txid, vout_n",
    ).fetch_all(pool).await.unwrap();
    for (t, v, name, h, i, ty, a, ipfs) in events {
        rows.push((format!("asset_event:{}:{}", t, v), format!("{} {} {} {} {} {:?}", name, h, i, ty, n(&a), ipfs)));
    }
    rows.sort();
    rows
}

/// The columns that existed before schema v4 (`with_tx_count` = false leaves
/// out `addresses.tx_count`, whose meaning changed in v4, and strips the
/// v4-only `vin[].asset` enrichment from the tx JSON).
async fn snapshot_legacy(pool: &PgPool, with_tx_count: bool) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = Vec::new();
    let addrs: Vec<(String, BigDecimal, BigDecimal, BigDecimal, i32)> = sqlx::query_as(
        "SELECT address, balance, total_received, total_sent, tx_count FROM addresses ORDER BY address",
    ).fetch_all(pool).await.unwrap();
    for (a, b, r, s, c) in addrs {
        let count = if with_tx_count { c.to_string() } else { "-".to_string() };
        rows.push((format!("addr:{}", a), format!("{} {} {} {}", n(&b), n(&r), n(&s), count)));
    }
    let assets: Vec<(String, String, BigDecimal, i32, bool, bool, Option<String>, i32, String)> = sqlx::query_as(
        "SELECT name, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height, txid FROM assets ORDER BY name",
    ).fetch_all(pool).await.unwrap();
    for (name, t, a, u, r, h, i, bh, tx) in assets {
        rows.push((format!("asset:{}", name), format!("{} {} {} {} {} {:?} {} {}", t, n(&a), u, r, h, i, bh, tx)));
    }
    let aa: Vec<(String, String, BigDecimal)> = sqlx::query_as(
        "SELECT address, asset_name, balance FROM address_assets ORDER BY address, asset_name",
    ).fetch_all(pool).await.unwrap();
    for (a, name, b) in aa {
        rows.push((format!("addr_asset:{}:{}", a, name), n(&b)));
    }
    let ta: Vec<(String, String, i32, i32)> = sqlx::query_as(
        "SELECT txid, address, block_height, time FROM tx_addresses ORDER BY txid, address",
    ).fetch_all(pool).await.unwrap();
    for (t, a, h, ti) in ta {
        rows.push((format!("tx_addr:{}:{}", t, a), format!("{} {}", h, ti)));
    }
    let txs: Vec<(String, i32, i32, BigDecimal, serde_json::Value)> = sqlx::query_as(
        "SELECT txid, block_height, time, total_output, raw_data FROM transactions ORDER BY txid",
    ).fetch_all(pool).await.unwrap();
    for (t, h, ti, tot, mut raw) in txs {
        if !with_tx_count {
            if let Some(vins) = raw["vin"].as_array_mut() {
                for v in vins {
                    if let Some(o) = v.as_object_mut() {
                        o.remove("asset");
                    }
                }
            }
        }
        rows.push((format!("tx:{}", t), format!("{} {} {} vin={}", h, ti, n(&tot), raw["vin"])));
    }
    let blocks: Vec<(i32, String, i32, BigDecimal, i32)> = sqlx::query_as(
        "SELECT height, hash, time, difficulty, tx_count FROM blocks ORDER BY height",
    ).fetch_all(pool).await.unwrap();
    for (h, hash, t, d, c) in blocks {
        rows.push((format!("block:{}", h), format!("{} {} {} {}", hash, t, n(&d), c)));
    }
    let state: Option<(Option<String>,)> = sqlx::query_as("SELECT value FROM sync_state WHERE key = 'last_height'")
        .fetch_optional(pool).await.unwrap();
    rows.push(("sync_state".into(), state.and_then(|(v,)| v).unwrap_or_default()));
    rows.sort();
    rows
}

/// (name, definition) of every index in the public schema, sorted.
async fn index_inventory(pool: &PgPool) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    ).fetch_all(pool).await.unwrap();
    rows.sort();
    rows
}

/// reloptions of the tables bulk mode touches (None = defaults).
async fn autovacuum_options(pool: &PgPool) -> Vec<(String, Option<Vec<String>>)> {
    let mut rows: Vec<(String, Option<Vec<String>>)> = sqlx::query_as(
        "SELECT relname, reloptions FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname = ANY($1) ORDER BY relname",
    ).bind(vec!["blocks","transactions","tx_addresses","tx_address_assets","asset_events","addresses","address_assets"])
    .fetch_all(pool).await.unwrap();
    rows.sort();
    rows
}

/// Decimal as a normalized string (no trailing zeros), independent of the
/// scale the driver decodes NUMERIC with.
fn n(d: &BigDecimal) -> String {
    d.normalized().to_plain_string()
}

fn get<'a>(snap: &'a [(String, String)], key: &str) -> &'a str {
    &snap.iter().find(|(k, _)| k == key).unwrap_or_else(|| panic!("missing {}", key)).1
}

#[tokio::test]
#[ignore]
async fn writer_produces_expected_ledger() {
    let Some(pool) = test_pool().await else { return };

    let batch = prepare_offline(fixture_chain());
    BatchWriter::new(&pool, true).write(&batch).await.expect("write batch");
    let snap = snapshot(&pool).await;

    // tx_count = distinct transactions the address takes part in
    // A: c0, t1
    assert_eq!(get(&snap, "addr:A"), "0.4 50000.4 50000 2");
    // B: c1, c2, t2, t3 (two outputs to B in t3 count once)
    assert_eq!(get(&snap, "addr:B"), "100600 100600 0 4");
    // C: t1, t2, t3
    assert_eq!(get(&snap, "addr:C"), "49399.3 148898.2 99498.9 3");
    // D: t3 (asset received), t4 (0-XNA asset spend still counts as a tx)
    assert_eq!(get(&snap, "addr:D"), "0 0 0 2");
    // E: c3, t4
    assert_eq!(get(&snap, "addr:E"), "50000 50000 0 2");

    // Per-transaction deltas
    assert_eq!(get(&snap, "tx_addr_delta:t1:A"), "+0.4 -50000");
    assert_eq!(get(&snap, "tx_addr_delta:t1:C"), "+49999.5 -0");
    assert_eq!(get(&snap, "tx_addr_delta:t3:B"), "+100 -0");
    assert_eq!(get(&snap, "tx_addr_delta:t3:C"), "+49399.3 -49499.4");
    assert_eq!(get(&snap, "tx_addr_delta:t4:D"), "+0 -0");
    assert_eq!(get(&snap, "tx_addr_asset:t2:C:TOKEN"), "1000 2");
    assert_eq!(get(&snap, "tx_addr_asset:t3:C:TOKEN"), "250 2");   // -1000 +500 +750
    assert_eq!(get(&snap, "tx_addr_asset:t3:D:TOKEN"), "250 2");
    assert_eq!(get(&snap, "tx_addr_asset:t4:D:TOKEN"), "-250 3");
    assert_eq!(get(&snap, "tx_addr_asset:t4:E:TOKEN"), "250 3");

    // raw_data layout: hex in its own column, block lists txids only
    assert_eq!(get(&snap, "tx_v4:t3"), "idx=2 hex=Some([0]) json_hex=false fee=0.1");
    assert_eq!(get(&snap, "tx_v4:c2"), "idx=0 hex=Some([0]) json_hex=false fee=0");
    assert_eq!(get(&snap, "tx_v4:t1"), "idx=1 hex=Some([0]) json_hex=false fee=0.1");
    assert_eq!(get(&snap, "tx_v4:t4"), "idx=1 hex=Some([0]) json_hex=false fee=0");
    assert_eq!(get(&snap, "block_v4:2"), r#"tx=["c2","t2","t3"] size=300"#);

    // TOKEN: issued 1000 + reissued 500, ipfs hash from the reissue, first height/txid kept
    assert_eq!(get(&snap, "asset:TOKEN"), "reissue_asset 1500 0 true true Some(\"QmHash2\") 2 t2");
    assert_eq!(get(&snap, "asset:TOKEN!"), "new_asset 1 0 true false None 2 t2");

    // C: +1000 (issue) -1000 (spent) +500 (reissue) +750 (transfer back)
    assert_eq!(get(&snap, "addr_asset:C:TOKEN"), "1250");
    assert_eq!(get(&snap, "addr_asset:C:TOKEN!"), "1");
    assert_eq!(get(&snap, "addr_asset:D:TOKEN"), "0");
    assert_eq!(get(&snap, "addr_asset:E:TOKEN"), "250");

    // History rows: one per (tx, address), including the 0-XNA asset spend by D in t4
    assert_eq!(get(&snap, "tx_addr:t4:D"), "3 1700000180");
    assert_eq!(get(&snap, "tx_addr:t4:E"), "3 1700000180");
    assert!(snap.iter().all(|(k, _)| k != "tx_addr:t1:"), "OP_RETURN output must not be indexed");
    assert_eq!(snap.iter().filter(|(k, _)| k.starts_with("tx_addr:t3:")).count(), 3); // B, C, D

    // Inputs are enriched with address/value in raw_data, total_output is exact
    let t1 = get(&snap, "tx:t1");
    assert!(t1.starts_with("1 1700000060 49999.9 "), "{}", t1);
    // Amounts are strings in the stored JSON (exact for JavaScript consumers)
    assert!(t1.contains(r#""addresses":["A"]"#) && t1.contains(r#""value":"50000.00000000""#), "{}", t1);
    // Inputs that spend an asset output carry the asset (name + amount only)
    let t3 = get(&snap, "tx:t3");
    assert!(t3.contains(r#""asset":{"amount":"1000.00000000","name":"TOKEN"}"#), "{}", t3);
    assert!(t3.contains(r#""asset":{"amount":"1.00000000","name":"TOKEN!"}"#), "{}", t3);
    assert!(!t1.contains(r#""asset""#), "plain XNA inputs have no asset: {}", t1);

    assert_eq!(get(&snap, "block:3"), format!("{:056x}{:08x} 1700000180 0.1 2", 4, 0));
    assert_eq!(get(&snap, "sync_state"), "3");
}

#[tokio::test]
#[ignore]
async fn result_does_not_depend_on_batching() {
    let Some(pool) = test_pool().await else { return };

    let chain = fixture_chain();

    // One batch with everything
    BatchWriter::new(&pool, false).write(&prepare_offline(chain.clone())).await.unwrap();
    let all_at_once = snapshot(&pool).await;

    // One block per batch, resolving inputs through the cache like the engine does
    let pool2 = test_pool().await.unwrap();
    let cache = Mutex::new(PrevOutCache::new(1000));
    for b in &chain {
        let mut prev_outs = HashMap::new();
        {
            let mut c = cache.lock().unwrap();
            for t in &b.tx {
                c.insert(t.txid.clone(), prev_outs_of(t));
            }
            for t in &b.tx {
                for vin in &t.vin {
                    if let Some(ref id) = vin.txid {
                        prev_outs.insert(id.clone(), c.get(id).expect("prev out in cache"));
                    }
                }
            }
        }
        let batch = PreparedBatch { blocks: vec![b.clone()], prev_outs };
        BatchWriter::new(&pool2, true).write(&batch).await.unwrap();
    }
    let one_by_one = snapshot(&pool2).await;

    assert_eq!(all_at_once, one_by_one);
}

/// Reference implementation: the per-event statements the syncer executed
/// before batching (copied verbatim from the previous processor/repositories),
/// driven by the same event walk. Used to prove the batch writer produces the
/// same ledger.
mod reference {
    use super::*;
    use crate::types::Transaction;
    use sqlx::{Postgres, Transaction as SqlxTransaction};

    fn dec(v: f64) -> BigDecimal {
        // Old conversion: exact binary expansion of the f64.
        BigDecimal::try_from(v).unwrap_or_default()
    }

    fn f(a: crate::types::Amount) -> f64 {
        a.sats() as f64 / 1e8
    }

    async fn addr_delta(tx: &mut SqlxTransaction<'_, Postgres>, address: &str, b: f64, r: f64, s: f64) {
        sqlx::query(
            r#"
            INSERT INTO addresses (address, balance, total_received, total_sent, tx_count)
            VALUES ($1, $2, $3, $4, 1)
            ON CONFLICT (address) DO UPDATE SET
                balance = addresses.balance + $2,
                total_received = addresses.total_received + $3,
                total_sent = addresses.total_sent + $4,
                tx_count = addresses.tx_count + 1
            "#,
        )
        .bind(address).bind(dec(b)).bind(dec(r)).bind(dec(s))
        .execute(&mut **tx).await.unwrap();
    }

    async fn addr_asset_delta(tx: &mut SqlxTransaction<'_, Postgres>, address: &str, name: &str, delta: f64) {
        sqlx::query(
            r#"
            INSERT INTO address_assets (address, asset_name, balance)
            VALUES ($1, $2, $3)
            ON CONFLICT (address, asset_name) DO UPDATE SET
                balance = address_assets.balance + $3
            "#,
        )
        .bind(address).bind(name).bind(dec(delta))
        .execute(&mut **tx).await.unwrap();
    }

    async fn tx_address(tx: &mut SqlxTransaction<'_, Postgres>, txid: &str, address: &str, block: &Block) {
        sqlx::query(
            r#"
            INSERT INTO tx_addresses (txid, address, block_height, time)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (txid, address) DO NOTHING
            "#,
        )
        .bind(txid).bind(address).bind(block.height as i32).bind(block.time as i32)
        .execute(&mut **tx).await.unwrap();
    }

    pub async fn write_chain(pool: &PgPool, blocks: &[Block]) {
        let mut cache: HashMap<String, Transaction> = HashMap::new();
        for block in blocks {
            for t in &block.tx {
                cache.insert(t.txid.clone(), t.clone());
            }
        }

        for block in blocks {
            let mut db = pool.begin().await.unwrap();

            sqlx::query(
                r#"
                INSERT INTO blocks (height, hash, time, difficulty, tx_count, raw_data)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (height) DO UPDATE SET
                    hash = EXCLUDED.hash, time = EXCLUDED.time, difficulty = EXCLUDED.difficulty,
                    tx_count = EXCLUDED.tx_count, raw_data = EXCLUDED.raw_data
                "#,
            )
            .bind(block.height as i32).bind(&block.hash).bind(block.time as i32)
            .bind(dec(block.difficulty)).bind(block.tx.len() as i32)
            .bind(serde_json::to_value(block).unwrap())
            .execute(&mut *db).await.unwrap();

            for transaction in &block.tx {
                let total_output: f64 = transaction.vout.iter().map(|v| f(v.value)).sum();
                sqlx::query(
                    r#"
                    INSERT INTO transactions (txid, block_height, time, total_output, raw_data)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (txid) DO UPDATE SET
                        block_height = EXCLUDED.block_height, time = EXCLUDED.time,
                        total_output = EXCLUDED.total_output, raw_data = EXCLUDED.raw_data
                    "#,
                )
                .bind(&transaction.txid).bind(block.height as i32).bind(block.time as i32)
                .bind(dec(total_output)).bind(serde_json::to_value(transaction).unwrap())
                .execute(&mut *db).await.unwrap();

                // Inputs
                let mut enriched = transaction.clone();
                for (i, vin) in transaction.vin.iter().enumerate() {
                    if vin.is_coinbase() { continue; }
                    let (Some(txid), Some(vout_idx)) = (&vin.txid, vin.vout) else { continue };
                    let prev_tx = cache.get(txid).expect("prev tx");
                    let Some(prev_out) = prev_tx.vout.get(vout_idx as usize) else { continue };
                    let addr = match &prev_out.script_pub_key.addresses {
                        Some(a) if !a.is_empty() => &a[0],
                        _ => continue,
                    };
                    let val = f(prev_out.value);
                    enriched.vin[i].addresses = Some(vec![addr.clone()]);
                    enriched.vin[i].value = Some(prev_out.value);
                    if val > 0.0 {
                        addr_delta(&mut db, addr, -val, 0.0, val).await;
                    }
                    if let Some(ref asset) = prev_out.script_pub_key.asset {
                        addr_asset_delta(&mut db, addr, &asset.name, -f(asset.amount)).await;
                    }
                    if val > 0.0 || prev_out.script_pub_key.asset.is_some() {
                        tx_address(&mut db, &transaction.txid, addr, block).await;
                    }
                }

                sqlx::query("UPDATE transactions SET raw_data = $1 WHERE txid = $2")
                    .bind(serde_json::to_value(&enriched).unwrap()).bind(&transaction.txid)
                    .execute(&mut *db).await.unwrap();

                // Outputs
                for vout in &transaction.vout {
                    let addr = match &vout.script_pub_key.addresses {
                        Some(a) if !a.is_empty() => &a[0],
                        _ => continue,
                    };
                    let val = f(vout.value);
                    if val >= 0.0 {
                        addr_delta(&mut db, addr, val, val, 0.0).await;
                        if let Some(ref asset) = vout.script_pub_key.asset {
                            let st = &vout.script_pub_key.script_type;
                            if st == "new_asset" || st == "reissue_asset" {
                                sqlx::query(
                                    r#"
                                    INSERT INTO assets (name, type, amount, units, reissuable, has_ipfs, ipfs_hash, block_height, txid)
                                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                                    ON CONFLICT (name) DO UPDATE SET
                                        type = COALESCE(EXCLUDED.type, assets.type),
                                        amount = assets.amount + EXCLUDED.amount,
                                        units = COALESCE(EXCLUDED.units, assets.units),
                                        reissuable = COALESCE(EXCLUDED.reissuable, assets.reissuable),
                                        has_ipfs = COALESCE(EXCLUDED.has_ipfs, assets.has_ipfs),
                                        ipfs_hash = COALESCE(EXCLUDED.ipfs_hash, assets.ipfs_hash)
                                    "#,
                                )
                                .bind(&asset.name).bind(st).bind(dec(f(asset.amount)))
                                .bind(asset.units.unwrap_or(0))
                                .bind(asset.reissuable.map(|r| r != 0).unwrap_or(false))
                                .bind(asset.has_ipfs.map(|h| h != 0).unwrap_or(false))
                                .bind(&asset.ipfs_hash).bind(block.height as i32).bind(&transaction.txid)
                                .execute(&mut *db).await.unwrap();
                            }
                            addr_asset_delta(&mut db, addr, &asset.name, f(asset.amount)).await;
                        }
                        tx_address(&mut db, &transaction.txid, addr, block).await;
                    }
                }
            }

            sqlx::query(
                "INSERT INTO sync_state (key, value) VALUES ('last_height', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            )
            .bind(block.height.to_string())
            .execute(&mut *db).await.unwrap();

            db.commit().await.unwrap();
        }
    }
}

/// Snapshot with decimals rounded to 8 places, so the old exact-binary values
/// (e.g. 0.4000000000000000222...) compare equal to the new exact ones (0.4).
async fn snapshot_rounded(pool: &PgPool) -> Vec<(String, String)> {
    for (table, cols) in [
        ("addresses", vec!["balance", "total_received", "total_sent"]),
        ("address_assets", vec!["balance"]),
        ("assets", vec!["amount"]),
        ("transactions", vec!["total_output"]),
        ("blocks", vec!["difficulty"]),
    ] {
        for col in cols {
            sqlx::query(&format!("UPDATE {t} SET {c} = ROUND({c}, 8)", t = table, c = col))
                .execute(pool).await.unwrap();
        }
    }
    // tx_count changed meaning in v4 (events -> distinct transactions), so it
    // is left out of this comparison; see `ledger_invariants_hold` for it.
    snapshot_legacy(pool, false).await
}

#[tokio::test]
#[ignore]
async fn batch_writer_matches_previous_per_event_implementation() {
    let Some(pool) = test_pool().await else { return };
    let chain = fixture_chain();

    reference::write_chain(&pool, &chain).await;
    let reference_snapshot = snapshot_rounded(&pool).await;

    let pool = test_pool().await.unwrap();
    BatchWriter::new(&pool, true).write(&prepare_offline(chain)).await.unwrap();
    let batch_snapshot = snapshot_rounded(&pool).await;

    assert_eq!(reference_snapshot.len(), batch_snapshot.len());
    for (r, b) in reference_snapshot.iter().zip(batch_snapshot.iter()) {
        assert_eq!(r, b);
    }
}

/// The v4 ledgers are derivable from the history rows.
#[tokio::test]
#[ignore]
async fn ledger_invariants_hold() {
    let Some(pool) = test_pool().await else { return };
    BatchWriter::new(&pool, true).write(&prepare_offline(fixture_chain())).await.unwrap();

    let (bad_balances,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM addresses a
           WHERE a.balance <> (SELECT COALESCE(SUM(received - sent), 0) FROM tx_addresses t WHERE t.address = a.address)
              OR a.total_received <> (SELECT COALESCE(SUM(received), 0) FROM tx_addresses t WHERE t.address = a.address)
              OR a.total_sent <> (SELECT COALESCE(SUM(sent), 0) FROM tx_addresses t WHERE t.address = a.address)
              OR a.tx_count <> (SELECT COUNT(*) FROM tx_addresses t WHERE t.address = a.address)"#,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(bad_balances, 0);

    let (bad_assets,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM address_assets aa
           WHERE aa.balance <> (SELECT COALESCE(SUM(delta), 0) FROM tx_address_assets t
                                WHERE t.address = aa.address AND t.asset_name = aa.asset_name)"#,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(bad_assets, 0);

    // Every address referenced by history rows exists (FK) and has a delta row
    let (orphans,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM tx_address_assets t LEFT JOIN tx_addresses h USING (txid, address) WHERE h.txid IS NULL",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(orphans, 0, "asset moves must always have a tx_addresses row");
}

/// Two more blocks on top of the fixture chain: a new address, a reissue with
/// new metadata, a brand new asset and asset transfers.
fn extension_blocks(chain: &[Block]) -> Vec<Block> {
    let b3 = chain.last().unwrap();
    let b4 = block(4, Some(&b3.hash), vec![
        coinbase_tx("c4", vec![out(0, 50000.0, Some("F"))]),
        // C reissues TOKEN again (new ipfs) and issues OTHER to F
        tx("t5", vec![("t3", 0), ("t3", 6)], vec![
            out(0, 49399.2, Some("C")),
            asset_out(1, "C", "reissue_asset", "TOKEN", 100.0, Some("QmHash3")),
            asset_out(2, "C", "transfer_asset", "TOKEN!", 1.0, None),
            asset_out(3, "F", "new_asset", "OTHER", 5.0, None),
        ]),
    ]);
    let b5 = block(5, Some(&b4.hash), vec![
        coinbase_tx("c5", vec![out(0, 50000.0, Some("F"))]),
        // E sends 100 TOKEN to F, keeps 150
        tx("t6", vec![("t4", 0)], vec![
            asset_out(0, "F", "transfer_asset", "TOKEN", 100.0, None),
            asset_out(1, "E", "transfer_asset", "TOKEN", 150.0, None),
        ]),
    ]);
    vec![b4, b5]
}

/// Rolling back to height h leaves the database exactly as a fresh sync of
/// blocks 0..h would, for every h.
#[tokio::test]
#[ignore]
async fn rollback_restores_previous_state() {
    use super::rollback::rollback_from_height;

    let Some(pool) = test_pool().await else { return };
    let mut chain = fixture_chain();
    chain.extend(extension_blocks(&chain));
    let n = chain.len() as i64;

    // (h = 0 is covered separately: a never-synced database has no
    // sync_state row while a rolled-back one says -1)
    for h in (1..=n).rev() {
        // Full sync in one batch, then roll back to h
        let pool = test_pool().await.unwrap();
        BatchWriter::new(&pool, true).write(&prepare_offline(chain.clone())).await.unwrap();
        let report = rollback_from_height(&pool, h).await.unwrap();
        assert_eq!(report.blocks_deleted as i64, n - h);
        let rolled_back = snapshot(&pool).await;

        // Fresh sync of blocks 0..h (block by block, like the engine near the tip)
        let pool = test_pool().await.unwrap();
        for i in 0..h as usize {
            let batch = prepare_offline_with(vec![chain[i].clone()], &chain[..i]);
            BatchWriter::new(&pool, true).write(&batch).await.unwrap();
        }
        let fresh = snapshot(&pool).await;

        assert_eq!(rolled_back, fresh, "state after rolling back to {} differs from a fresh sync", h);
    }
}

/// Spot checks on the interesting rollback paths (assets rebuilt / deleted,
/// addresses that vanish).
#[tokio::test]
#[ignore]
async fn rollback_rebuilds_assets_and_removes_orphans() {
    use super::rollback::rollback_from_height;

    let Some(pool) = test_pool().await else { return };
    let chain = fixture_chain();
    let ext = extension_blocks(&chain);
    BatchWriter::new(&pool, true).write(&prepare_offline(chain.clone())).await.unwrap();
    BatchWriter::new(&pool, true).write(&prepare_offline_with(ext, &chain)).await.unwrap();

    let before = snapshot(&pool).await;
    assert_eq!(get(&before, "asset:TOKEN"), "reissue_asset 1600 0 true true Some(\"QmHash3\") 2 t2");
    assert!(before.iter().any(|(k, _)| k == "asset:OTHER"));
    assert!(before.iter().any(|(k, _)| k == "addr:F"));
    assert_eq!(get(&before, "addr_asset:F:TOKEN"), "100");

    let report = rollback_from_height(&pool, 4).await.unwrap();
    assert_eq!(report.blocks_deleted, 2);
    assert_eq!(report.assets_rebuilt, 1);   // TOKEN back to its 2 earlier events
    assert_eq!(report.assets_deleted, 1);   // OTHER never existed
    assert!(report.addresses_removed >= 1); // F

    let after = snapshot(&pool).await;
    // TOKEN: 1000 + 500, metadata from the reissue in block 2, first event kept
    assert_eq!(get(&after, "asset:TOKEN"), "reissue_asset 1500 0 true true Some(\"QmHash2\") 2 t2");
    assert!(after.iter().all(|(k, _)| k != "asset:OTHER"));
    assert!(after.iter().all(|(k, _)| !k.starts_with("addr:F") && !k.starts_with("addr_asset:F:")));
    assert_eq!(get(&after, "addr_asset:E:TOKEN"), "250");
    assert_eq!(get(&after, "addr:C"), "49399.3 148898.2 99498.9 3");
    assert_eq!(get(&after, "sync_state"), "3");

    // Rolling back above the tip changes nothing (never moves the state forward)
    let noop = rollback_from_height(&pool, 50).await.unwrap();
    assert_eq!(noop.blocks_deleted, 0);
    assert_eq!(snapshot(&pool).await, after);

    // Rolling back to genesis empties everything
    rollback_from_height(&pool, 0).await.unwrap();
    let empty = snapshot(&pool).await;
    assert_eq!(empty, vec![("sync_state".to_string(), "-1".to_string())]);
}

/// Amounts above 2^53 satoshis survive the whole path: node JSON -> ledger ->
/// stored JSON (as strings) -> fee, with satoshi precision.
#[tokio::test]
#[ignore]
async fn amounts_above_2_pow_53_sats_are_exact_end_to_end() {
    let Some(pool) = test_pool().await else { return };

    // 21,000,000,000.12345678 XNA = 2.1e18 sats > 2^53 (9.007e15) and > f64's 15-17 digits
    let b0 = block(0, None, vec![coinbase_tx("w0", vec![out_exact(0, "21000000000.12345678", "W")])]);
    let b1 = block(1, Some(&b0.hash), vec![
        coinbase_tx("w1", vec![out(0, 50000.0, Some("M"))]),
        tx("s1", vec![("w0", 0)], vec![
            out_exact(0, "21000000000.00000001", "X"),
            out_exact(1, "0.12345676", "W"),
            // fee = 0.00000001
        ]),
    ]);
    // Same block json in a batch => same values (also proves the fixture path is exact)
    let batch = prepare_offline(vec![b0, b1]);
    assert_eq!(batch.blocks[0].tx[0].vout[0].value.sats(), 2_100_000_000_012_345_678);

    BatchWriter::new(&pool, true).write(&batch).await.unwrap();

    let (w_balance, w_received, w_sent): (BigDecimal, BigDecimal, BigDecimal) = sqlx::query_as(
        "SELECT balance, total_received, total_sent FROM addresses WHERE address = 'W'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(n(&w_balance), "0.12345676");
    assert_eq!(n(&w_received), "21000000000.24691354");
    assert_eq!(n(&w_sent), "21000000000.12345678");

    let (x_balance,): (BigDecimal,) = sqlx::query_as("SELECT balance FROM addresses WHERE address = 'X'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(n(&x_balance), "21000000000.00000001");

    let (total, fee, raw): (BigDecimal, Option<BigDecimal>, serde_json::Value) = sqlx::query_as(
        "SELECT total_output, fee, raw_data FROM transactions WHERE txid = 's1'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(n(&total), "21000000000.12345677");
    assert_eq!(n(&fee.unwrap()), "0.00000001");
    // Stored JSON carries the exact literals as strings
    assert_eq!(raw["vin"][0]["value"], "21000000000.12345678");
    assert_eq!(raw["vout"][0]["value"], "21000000000.00000001");
    assert_eq!(raw["vout"][1]["value"], "0.12345676");
    // ...and what a JavaScript consumer would get from a JSON number instead
    let as_f64: f64 = "21000000000.12345678".parse().unwrap();
    assert_ne!(format!("{:.8}", as_f64), "21000000000.12345678", "the f64 path really is lossy");

    let (received, sent): (BigDecimal, BigDecimal) = sqlx::query_as(
        "SELECT received, sent FROM tx_addresses WHERE txid = 's1' AND address = 'W'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(n(&received), "0.12345676");
    assert_eq!(n(&sent), "21000000000.12345678");
}

// ---------------------------------------------------------------------------
// Bulk mode: deferred indexes / paused autovacuum during the initial sync
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn bulk_mode_round_trip_restores_indexes_and_autovacuum() {
    use crate::db::bulk;

    let Some(pool) = test_pool().await else { return };
    sqlx::query("DELETE FROM sync_state WHERE key = 'bulk_mode'").execute(&pool).await.unwrap();
    // Start from a clean state in case a previous test aborted midway
    bulk::exit(&pool, "64MB").await.unwrap();

    let indexes_before = index_inventory(&pool).await;
    let options_before = autovacuum_options(&pool).await;
    assert!(indexes_before.iter().any(|(n, _)| n == "idx_txaddr_address_time"));
    assert!(options_before.iter().all(|(_, o)| o.is_none()), "no reloptions expected initially");

    // Enter: deferrable indexes gone, the rest untouched, autovacuum off, state recorded
    let state = bulk::enter(&pool).await.unwrap();
    assert_eq!(state.indexes.len(), 6, "{:?}", state.indexes);
    assert_eq!(state.tables.len(), 7);
    let during = index_inventory(&pool).await;
    for gone in ["idx_txaddr_address_time", "idx_txaa_address_height", "idx_txaa_asset_height", "idx_asset_events_name", "idx_addr_balance", "idx_addr_asset_bal"] {
        assert!(during.iter().all(|(n, _)| n != gone), "{} should be dropped", gone);
    }
    for kept in ["tx_addresses_pkey", "transactions_pkey", "idx_txaddr_time", "idx_txaddr_height", "idx_tx_time", "idx_tx_height_index", "idx_blocks_time", "blocks_hash_key"] {
        assert!(during.iter().any(|(n, _)| n == kept), "{} must be kept", kept);
    }
    assert!(autovacuum_options(&pool).await.iter().all(|(_, o)| o.as_ref().is_some_and(|v| v.iter().any(|x| x == "autovacuum_enabled=false"))));
    assert!(bulk::state(&pool).await.unwrap().is_some());

    // Writing while in bulk mode works (PKs still there for ON CONFLICT)
    BatchWriter::new(&pool, true).write(&prepare_offline(fixture_chain())).await.unwrap();

    // Exit: everything back exactly as the migrations built it
    bulk::exit(&pool, "64MB").await.unwrap();
    assert_eq!(index_inventory(&pool).await, indexes_before);
    assert_eq!(autovacuum_options(&pool).await, options_before);
    assert!(bulk::state(&pool).await.unwrap().is_none());

    // Idempotent
    bulk::exit(&pool, "64MB").await.unwrap();
    let again = bulk::enter(&pool).await.unwrap();
    assert_eq!(again.indexes.len(), 6);
    bulk::exit(&pool, "64MB").await.unwrap();
    assert_eq!(index_inventory(&pool).await, indexes_before);
}

/// A crash between rebuilding two indexes leaves a state record with the
/// remaining ones; the next exit finishes the job.
#[tokio::test]
#[ignore]
async fn bulk_mode_exit_resumes_after_a_partial_rebuild() {
    use crate::db::bulk;

    let Some(pool) = test_pool().await else { return };
    bulk::exit(&pool, "64MB").await.unwrap();
    let indexes_before = index_inventory(&pool).await;

    let mut state = bulk::enter(&pool).await.unwrap();
    // Simulate: two indexes already rebuilt (recreate them by hand and drop
    // them from the record), the process dies before the rest.
    for done in state.indexes.drain(..2).collect::<Vec<_>>() {
        sqlx::query(&done.def).execute(&pool).await.unwrap();
    }
    sqlx::query("UPDATE sync_state SET value = $1 WHERE key = 'bulk_mode'")
        .bind(serde_json::to_string(&state).unwrap())
        .execute(&pool).await.unwrap();

    bulk::exit(&pool, "64MB").await.unwrap();
    assert_eq!(index_inventory(&pool).await, indexes_before);
    assert!(bulk::state(&pool).await.unwrap().is_none());
    assert!(autovacuum_options(&pool).await.iter().all(|(_, o)| o.is_none()));
}

/// Synthetic chain shaped like Neurai mainnet (~1.1 tx per block: mostly
/// coinbase-only blocks, some with a payout tx spending earlier coinbases).
fn synthetic_chain(n_blocks: i64) -> Vec<Block> {
    let mut blocks = Vec::with_capacity(n_blocks as usize);
    let mut prev_hash: Option<String> = None;
    let mut unspent: Vec<(String, u32, f64)> = Vec::new();
    for h in 0..n_blocks {
        let miner = format!("M{}", h % 7);
        let cb = format!("cb{}", h);
        let mut txs = vec![coinbase_tx(&cb, vec![out(0, 50000.0, Some(&miner))])];
        unspent.push((cb.clone(), 0, 50000.0));
        if h % 10 == 3 && unspent.len() > 20 {
            // payout: spend 8 old coinbases to 6 outputs
            let inputs: Vec<(String, u32, f64)> = unspent.drain(..8).collect();
            let total: f64 = inputs.iter().map(|i| i.2).sum();
            let txid = format!("p{}", h);
            let outs: Vec<serde_json::Value> = (0..6u32)
                .map(|i| out(i, (total - 0.01) / 6.0, Some(&format!("U{}", (h + i as i64) % 500))))
                .collect();
            let ins: Vec<(&str, u32)> = inputs.iter().map(|(t, n, _)| (t.as_str(), *n)).collect();
            txs.push(tx(&txid, ins, outs));
        }
        let b = block(h, prev_hash.as_deref(), txs);
        prev_hash = Some(b.hash.clone());
        blocks.push(b);
    }
    blocks
}

/// Not a correctness test: prints how long the previous per-event writer and
/// the batch writer take for the same synthetic chain.
#[tokio::test]
#[ignore]
async fn bench_writer_vs_reference() {
    let Some(pool) = test_pool().await else { return };
    let n: i64 = std::env::var("BENCH_BLOCKS").ok().and_then(|v| v.parse().ok()).unwrap_or(5_000);
    let batch: usize = std::env::var("BENCH_BATCH").ok().and_then(|v| v.parse().ok()).unwrap_or(250);
    let chain = synthetic_chain(n);

    let t = std::time::Instant::now();
    reference::write_chain(&pool, &chain).await;
    let ref_secs = t.elapsed().as_secs_f64();
    println!("reference (per-event, commit per block): {} blocks in {:.2}s = {:.0} blocks/s",
        n, ref_secs, n as f64 / ref_secs);

    for async_commit in [false, true] {
        let pool = test_pool().await.unwrap();
        let cache = Mutex::new(PrevOutCache::new(100_000));
        let writer = BatchWriter::new(&pool, async_commit);
        let t = std::time::Instant::now();
        for chunk in chain.chunks(batch) {
            let mut prev_outs = HashMap::new();
            {
                let mut c = cache.lock().unwrap();
                for b in chunk {
                    for tx in &b.tx {
                        c.insert(tx.txid.clone(), prev_outs_of(tx));
                    }
                }
                for b in chunk {
                    for tx in &b.tx {
                        for vin in &tx.vin {
                            if let Some(ref id) = vin.txid {
                                prev_outs.insert(id.clone(), c.get(id).unwrap());
                            }
                        }
                    }
                }
            }
            writer.write(&PreparedBatch { blocks: chunk.to_vec(), prev_outs }).await.unwrap();
        }
        let secs = t.elapsed().as_secs_f64();
        println!("batch writer (batch={}, async_commit={}): {} blocks in {:.2}s = {:.0} blocks/s ({:.1}x)",
            batch, async_commit, n, secs, n as f64 / secs, ref_secs / secs);
    }
}

/// A populated database written with another schema version must not be
/// silently mixed with v4 rows.
#[tokio::test]
#[ignore]
async fn schema_guard_requires_explicit_resync() {
    use crate::db::schema::{ensure_schema_version, SCHEMA_VERSION};

    let Some(pool) = test_pool().await else { return };
    std::env::remove_var("RESYNC_ON_SCHEMA_CHANGE");

    // Empty database: stamped with the current version
    ensure_schema_version(&pool).await.expect("empty db is fine");
    let (v,): (Option<String>,) = sqlx::query_as("SELECT value FROM sync_state WHERE key = 'schema_version'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(v.as_deref(), Some(SCHEMA_VERSION));

    // Populated database claiming an older version: refused...
    BatchWriter::new(&pool, true).write(&prepare_offline(fixture_chain())).await.unwrap();
    sqlx::query("UPDATE sync_state SET value = '3' WHERE key = 'schema_version'").execute(&pool).await.unwrap();
    let err = ensure_schema_version(&pool).await.expect_err("must refuse");
    assert!(err.to_string().contains("RESYNC_ON_SCHEMA_CHANGE"), "{}", err);
    let (blocks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blocks").fetch_one(&pool).await.unwrap();
    assert_eq!(blocks, 4, "data must be untouched");

    // ...unless the operator asks for a resync, which wipes the indexed data
    std::env::set_var("RESYNC_ON_SCHEMA_CHANGE", "1");
    ensure_schema_version(&pool).await.expect("resync requested");
    std::env::remove_var("RESYNC_ON_SCHEMA_CHANGE");
    for table in ["blocks", "transactions", "addresses", "tx_addresses", "tx_address_assets", "assets", "address_assets"] {
        let (count,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {}", table)).fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0, "{} not wiped", table);
    }
    let (last,): (Option<String>,) = sqlx::query_as("SELECT value FROM sync_state WHERE key = 'last_height'")
        .fetch_optional(&pool).await.unwrap().unwrap_or((None,));
    assert!(last.is_none());
    let (v,): (Option<String>,) = sqlx::query_as("SELECT value FROM sync_state WHERE key = 'schema_version'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(v.as_deref(), Some(SCHEMA_VERSION));
}

/// The daily aggregation runs on the v4 layout and buckets by UTC day.
#[tokio::test]
#[ignore]
async fn daily_stats_aggregation_runs_and_buckets_by_utc_day() {
    use crate::db::repositories::DailyStatsRepository;
    use chrono::NaiveDate;

    let Some(pool) = test_pool().await else { return };
    sqlx::query("TRUNCATE daily_stats").execute(&pool).await.unwrap();
    // fixture blocks are at 1700000000 + h*60 => all on 2023-11-14 UTC
    BatchWriter::new(&pool, true).write(&prepare_offline(fixture_chain())).await.unwrap();

    DailyStatsRepository::aggregate_from_date(&pool, NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()).await.unwrap();

    let rows: Vec<(NaiveDate, i32, i32, BigDecimal, i32, i32, BigDecimal)> = sqlx::query_as(
        "SELECT date, block_count, tx_count, total_output, new_assets_count, active_address_count, new_supply FROM daily_stats ORDER BY date",
    ).fetch_all(&pool).await.unwrap();
    assert_eq!(rows.len(), 1);
    let (date, blocks, txs, vol, new_assets, active, new_supply) = &rows[0];
    // 4 coinbases of 50000 minus the fees they collected (0.1 + 0.1 + 0.1 + 0)
    assert_eq!(n(new_supply), "199999.7");
    assert_eq!(*date, NaiveDate::from_ymd_opt(2023, 11, 14).unwrap());
    assert_eq!(*blocks, 4);
    assert_eq!(*txs, 8);
    assert_eq!(*new_assets, 2); // TOKEN and TOKEN!
    assert_eq!(*active, 5);     // A B C D E
    // Σ total_output of all txs: 4 coinbases (200000) + t1 49999.9 + t2 49999.4 + t3 49499.3 + t4 0
    assert_eq!(n(vol), "349498.6");

    // A later start date that excludes everything touches nothing
    DailyStatsRepository::aggregate_from_date(&pool, NaiveDate::from_ymd_opt(2024, 1, 1).unwrap()).await.unwrap();
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM daily_stats").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
    assert_eq!(DailyStatsRepository::latest_date(&pool).await.unwrap(), Some(*date));

    // A version bump wipes the table (rebuilt by the next aggregation)
    sqlx::query("DELETE FROM sync_state WHERE key = 'daily_stats_version'").execute(&pool).await.unwrap();
    assert!(DailyStatsRepository::ensure_version(&pool).await.unwrap());
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM daily_stats").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
    assert!(!DailyStatsRepository::ensure_version(&pool).await.unwrap(), "already at the current version");
}


// ---------------------------------------------------------------------------
// Sync engine against an in-memory node: fetching, reorg detection, rollback
// ---------------------------------------------------------------------------

mod engine {
    use super::*;
    use crate::config::{ApiConfig, Config, DatabaseConfig, RpcConfig};
    use crate::error::{Result as SyncResult, SyncerError};
    use crate::rpc::NodeClient;
    use crate::sync::engine::SyncEngine;
    use crate::types::Transaction;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tokio::sync::watch;

    /// A node whose chain can be rewritten between steps.
    pub struct MockNode {
        chain: std::sync::Mutex<Vec<Block>>,
        pub prev_tx_calls: std::sync::atomic::AtomicUsize,
    }

    impl MockNode {
        fn new(chain: Vec<Block>) -> Self {
            Self { chain: std::sync::Mutex::new(chain), prev_tx_calls: Default::default() }
        }
        /// Replace everything from `from` upwards with `blocks`.
        fn reorg(&self, from: usize, blocks: Vec<Block>) {
            let mut c = self.chain.lock().unwrap();
            c.truncate(from);
            c.extend(blocks);
        }
        fn blocks(&self) -> Vec<Block> {
            self.chain.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl NodeClient for MockNode {
        async fn get_block_count(&self) -> SyncResult<i64> {
            Ok(self.chain.lock().unwrap().len() as i64 - 1)
        }
        async fn get_block_hash(&self, height: i64) -> SyncResult<String> {
            self.chain.lock().unwrap().get(height as usize).map(|b| b.hash.clone())
                .ok_or_else(|| SyncerError::RpcCall { method: "getblockhash".into(), code: -8, message: "Block height out of range".into() })
        }
        async fn get_block_by_height(&self, height: i64) -> SyncResult<Block> {
            self.chain.lock().unwrap().get(height as usize).cloned()
                .ok_or_else(|| SyncerError::RpcCall { method: "getblockhash".into(), code: -8, message: "Block height out of range".into() })
        }
        async fn get_prev_transaction(&self, txid: &str) -> SyncResult<Transaction> {
            self.prev_tx_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.chain.lock().unwrap().iter().flat_map(|b| b.tx.iter()).find(|t| t.txid == txid).cloned()
                .ok_or_else(|| SyncerError::Http { status: 404, body: format!("{} not found", txid), retry_after_secs: None })
        }
    }

    fn test_config(batch_size: usize, bulk_threshold: i64) -> Arc<Config> {
        Arc::new(Config {
            rpc: RpcConfig { user: "u".into(), pass: "p".into(), host: "mock".into(), port: 1, timeout: 1000, use_rest: false, retries: 1, retry_delay_ms: 1 },
            database: DatabaseConfig { user: "u".into(), pass: "p".into(), host: "db".into(), port: 5432, name: "n".into() },
            sync: serde_json::from_value(json!({
                "batchSize": batch_size, "prefetchBatches": 1, "blockFetchConcurrency": 4, "inputFetchConcurrency": 4,
                "bulkModeThreshold": bulk_threshold, "indexBuildMem": "64MB"
            })).unwrap(),
            api: ApiConfig { coingecko_url: String::new(), price_fetch_interval: 0 },
        })
    }

    fn engine(node: &Arc<MockNode>, pool: &PgPool, batch_size: usize) -> SyncEngine<MockNode> {
        engine_with_bulk(node, pool, batch_size, 0)
    }

    fn engine_with_bulk(node: &Arc<MockNode>, pool: &PgPool, batch_size: usize, bulk_threshold: i64) -> SyncEngine<MockNode> {
        let (_tx, rx) = watch::channel(false);
        // keep the sender alive for the engine's lifetime by leaking it (test only)
        std::mem::forget(_tx);
        SyncEngine::new(test_config(batch_size, bulk_threshold), Arc::clone(node), pool.clone(), rx)
    }

    /// Far behind -> the engine drops the deferrable indexes, syncs, and
    /// rebuilds them when it reaches the tip; the result equals a plain sync.
    #[tokio::test]
    #[ignore]
    async fn engine_uses_bulk_mode_during_a_long_catch_up() {
        use crate::db::bulk;

        let Some(pool) = test_pool().await else { return };
        bulk::exit(&pool, "64MB").await.unwrap();
        let indexes_before = index_inventory(&pool).await;

        let mut chain = fixture_chain();
        chain.extend(extension_blocks(&chain));
        for h in 6..=40 {
            let prev = chain.last().unwrap().hash.clone();
            chain.push(coinbase_only(h, &prev, 0));
        }
        let node = Arc::new(MockNode::new(chain.clone()));

        // threshold 10: 41 blocks behind -> bulk on; after the catch-up, 0 behind -> bulk off
        let mut eng = engine_with_bulk(&node, &pool, 5, 10);
        assert!(eng.step().await.unwrap());
        assert!(bulk::state(&pool).await.unwrap().is_some(), "bulk mode should be active right after the catch-up");
        assert!(index_inventory(&pool).await.iter().all(|(n, _)| n != "idx_addr_balance"));

        assert!(!eng.step().await.unwrap(), "at the tip");
        assert!(bulk::state(&pool).await.unwrap().is_none(), "bulk mode left at the tip");
        assert_eq!(index_inventory(&pool).await, indexes_before);
        assert!(autovacuum_options(&pool).await.iter().all(|(_, o)| o.is_none()));

        assert_eq!(snapshot(&pool).await, fresh_sync_snapshot(&chain).await);
    }

    /// Reference state: what the writer produces for `blocks` synced in order.
    async fn fresh_sync_snapshot(blocks: &[Block]) -> Vec<(String, String)> {
        let pool = test_pool().await.unwrap();
        for i in 0..blocks.len() {
            let batch = prepare_offline_with(vec![blocks[i].clone()], &blocks[..i]);
            BatchWriter::new(&pool, true).write(&batch).await.unwrap();
        }
        snapshot(&pool).await
    }

    fn coinbase_only(height: i64, prev: &str, variant: u32) -> Block {
        block_variant(height, Some(prev), vec![coinbase_tx(&format!("cb{}v{}", height, variant), vec![out(0, 50000.0, Some("P"))])], variant)
    }

    #[tokio::test]
    #[ignore]
    async fn engine_syncs_a_fresh_chain_in_batches() {
        let Some(pool) = test_pool().await else { return };
        let mut chain = fixture_chain();
        chain.extend(extension_blocks(&chain));
        let node = Arc::new(MockNode::new(chain.clone()));

        let mut eng = engine(&node, &pool, 2);
        assert!(eng.step().await.unwrap(), "first step syncs");
        assert!(!eng.step().await.unwrap(), "already at the tip");

        assert_eq!(snapshot(&pool).await, fresh_sync_snapshot(&chain).await);
        // Every previous output was in the batch or the cache: no node round trips
        assert_eq!(node.prev_tx_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    #[ignore]
    async fn engine_handles_a_reorg_near_the_tip() {
        let Some(pool) = test_pool().await else { return };
        let chain = fixture_chain(); // heights 0..=3
        let node = Arc::new(MockNode::new(chain.clone()));
        engine(&node, &pool, 2).step().await.unwrap();
        assert_eq!(get(&snapshot(&pool).await, "sync_state"), "3");

        // Node replaces block 3 and adds two more; 3' spends E's coinbase (c3
        // no longer exists) -> uses B's coinbase c1 instead.
        let b3p = block_variant(3, Some(&chain[2].hash), vec![
            coinbase_tx("c3p", vec![out(0, 50000.0, Some("Q"))]),
            tx("s3p", vec![("c1", 0)], vec![out(0, 49999.0, Some("R"))]),
        ], 1);
        let b4p = coinbase_only(4, &b3p.hash, 1);
        let b5p = coinbase_only(5, &b4p.hash, 1);
        node.reorg(3, vec![b3p, b4p, b5p]);

        // Fresh engine (empty cache): the spend of c1 must be resolved on the node
        let mut eng = engine(&node, &pool, 2);
        assert!(eng.step().await.unwrap());
        assert!(!eng.step().await.unwrap());
        assert!(node.prev_tx_calls.load(std::sync::atomic::Ordering::SeqCst) >= 1);

        assert_eq!(snapshot(&pool).await, fresh_sync_snapshot(&node.blocks()).await);
        // The orphaned block is gone, its addresses too
        let after = snapshot(&pool).await;
        assert!(after.iter().all(|(k, _)| k != "addr:E"));
        assert_eq!(get(&after, "sync_state"), "5");
    }

    #[tokio::test]
    #[ignore]
    async fn engine_handles_a_deep_reorg_far_from_the_tip() {
        let Some(pool) = test_pool().await else { return };
        let mut chain = fixture_chain();
        chain.extend(extension_blocks(&chain)); // 0..=5
        let node = Arc::new(MockNode::new(chain.clone()));
        engine(&node, &pool, 3).step().await.unwrap();
        assert_eq!(get(&snapshot(&pool).await, "sync_state"), "5");

        // Fork at height 2 (below the near-tip check) and grow far past it,
        // more than NEAR_TIP_WINDOW blocks, so only the previousblockhash
        // link of the first batch can reveal the fork.
        let mut new_blocks = vec![coinbase_only(2, &chain[1].hash, 7)];
        for h in 3..=160 {
            let prev = new_blocks.last().unwrap().hash.clone();
            new_blocks.push(coinbase_only(h, &prev, 7));
        }
        node.reorg(2, new_blocks);

        let mut eng = engine(&node, &pool, 50);
        // step 1: fork detected via the link -> rollback to 2 ; step 2: resync
        let mut steps = 0;
        while eng.step().await.unwrap() {
            steps += 1;
            assert!(steps < 5, "engine did not converge");
        }
        assert!(steps >= 2, "expected a rollback step followed by a sync step, got {}", steps);

        assert_eq!(snapshot(&pool).await, fresh_sync_snapshot(&node.blocks()).await);
        assert_eq!(get(&snapshot(&pool).await, "sync_state"), "160");
    }
}
