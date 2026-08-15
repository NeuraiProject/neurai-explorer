use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Arc;

use crate::types::{Amount, Transaction, Vout};

/// The part of a transaction output that is needed when the output is later
/// spent: who owned it and what it carried.
#[derive(Debug, Clone)]
pub struct PrevOut {
    /// First address of the output script, if any.
    pub address: Option<String>,
    /// XNA value.
    pub value: Amount,
    /// Asset carried by the output: (name, amount).
    pub asset: Option<(String, Amount)>,
}

impl PrevOut {
    pub fn from_vout(vout: &Vout) -> Self {
        let address = vout.script_pub_key.first_address().map(str::to_string);
        let asset = vout
            .script_pub_key
            .asset
            .as_ref()
            .map(|a| (a.name.clone(), a.amount));

        Self {
            address,
            value: vout.value,
            asset,
        }
    }
}

/// Outputs of a transaction, indexed by output number.
pub type PrevOuts = Arc<[PrevOut]>;

pub fn prev_outs_of(tx: &Transaction) -> PrevOuts {
    tx.vout.iter().map(PrevOut::from_vout).collect()
}

/// LRU cache of transaction outputs keyed by txid.
///
/// Only the fields needed to resolve inputs are kept, so a large number of
/// transactions fits in a modest amount of memory (roughly 100-200 bytes per
/// output), and inputs that spend recently synced outputs never hit the node.
pub struct PrevOutCache {
    cache: LruCache<String, PrevOuts>,
}

impl PrevOutCache {
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).expect("Cache capacity must be > 0");
        Self {
            cache: LruCache::new(capacity),
        }
    }

    pub fn get(&mut self, txid: &str) -> Option<PrevOuts> {
        self.cache.get(txid).cloned()
    }

    pub fn insert(&mut self, txid: String, outs: PrevOuts) {
        self.cache.put(txid, outs);
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }
}
