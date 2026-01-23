use lru::LruCache;
use std::num::NonZeroUsize;

use crate::types::Transaction;

/// LRU-based transaction cache with bounded memory usage
pub struct TransactionCache {
    cache: LruCache<String, Transaction>,
}

impl TransactionCache {
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).expect("Cache capacity must be > 0");
        Self {
            cache: LruCache::new(capacity),
        }
    }

    pub fn get(&mut self, txid: &str) -> Option<&Transaction> {
        self.cache.get(txid)
    }

    pub fn insert(&mut self, txid: String, tx: Transaction) {
        self.cache.put(txid, tx);
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    pub fn clear(&mut self) {
        self.cache.clear();
    }
}
