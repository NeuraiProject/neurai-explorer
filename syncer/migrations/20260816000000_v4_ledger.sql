-- Schema v4: exact amounts, per-transaction ledger deltas, deduplicated raw_data.
--
-- Data written by syncer < 3.2 is not compatible with this layout (tx_index,
-- raw_hex and the deltas cannot be backfilled without re-reading the chain).
-- The syncer refuses to start on a populated v3 database unless
-- RESYNC_ON_SCHEMA_CHANGE=1 is set, in which case it wipes the indexed data
-- and syncs again from genesis.

-- transactions: position inside the block, the raw bytes outside the JSON and
-- the fee (inputs - outputs, exact; 0 for coinbase; NULL if an input's value
-- could not be resolved).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS tx_index INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS raw_hex BYTEA,
    ADD COLUMN IF NOT EXISTS fee NUMERIC;
CREATE INDEX IF NOT EXISTS idx_tx_height_index ON transactions (block_height, tx_index);
DROP INDEX IF EXISTS idx_tx_height;

-- tx_addresses: XNA received / spent by the address in that transaction.
-- addresses.balance == SUM(received - sent), addresses.tx_count == COUNT(*)
ALTER TABLE tx_addresses
    ADD COLUMN IF NOT EXISTS received NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sent NUMERIC NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_txaddr_height ON tx_addresses (block_height);

-- Asset units moved per (transaction, address, asset).
-- address_assets.balance == SUM(delta)
CREATE TABLE IF NOT EXISTS tx_address_assets (
    txid         TEXT REFERENCES transactions(txid) ON DELETE CASCADE,
    address      TEXT REFERENCES addresses(address) ON DELETE CASCADE,
    asset_name   TEXT REFERENCES assets(name) ON DELETE CASCADE,
    delta        NUMERIC NOT NULL,
    block_height INTEGER,
    PRIMARY KEY (txid, address, asset_name)
);
CREATE INDEX IF NOT EXISTS idx_txaa_address ON tx_address_assets (address);
CREATE INDEX IF NOT EXISTS idx_txaa_asset ON tx_address_assets (asset_name);
CREATE INDEX IF NOT EXISTS idx_txaa_height ON tx_address_assets (block_height);

-- Asset issuance / reissuance events, in chain order. The `assets` row is a
-- fold of these (amount summed, metadata from the last event), which is how
-- it is rebuilt after a reorg rollback.
CREATE TABLE IF NOT EXISTS asset_events (
    txid         TEXT REFERENCES transactions(txid) ON DELETE CASCADE,
    vout_n       INTEGER NOT NULL,
    asset_name   TEXT REFERENCES assets(name) ON DELETE CASCADE,
    block_height INTEGER NOT NULL,
    tx_index     INTEGER NOT NULL,
    type         TEXT NOT NULL,
    amount       NUMERIC NOT NULL,
    units        INTEGER NOT NULL,
    reissuable   BOOLEAN NOT NULL,
    has_ipfs     BOOLEAN NOT NULL,
    ipfs_hash    TEXT,
    PRIMARY KEY (txid, vout_n)
);
CREATE INDEX IF NOT EXISTS idx_asset_events_name ON asset_events (asset_name);
CREATE INDEX IF NOT EXISTS idx_asset_events_height ON asset_events (block_height);

-- Mark empty databases as v4. Populated (v3) databases keep no version, which
-- makes the syncer stop and ask for a resync.
INSERT INTO sync_state (key, value)
SELECT 'schema_version', '4'
WHERE NOT EXISTS (SELECT 1 FROM blocks)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
