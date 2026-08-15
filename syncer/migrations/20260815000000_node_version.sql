-- Version string reported by the node (getnetworkinfo.subversion), so the
-- frontend can show which Neurai release the explorer is running against.
ALTER TABLE network_stats ADD COLUMN IF NOT EXISTS node_version TEXT;
