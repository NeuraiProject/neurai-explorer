/**
 * Centralized type definitions for the frontend
 * All types use consistent camelCase naming
 */

// ============================================
// Block Types
// ============================================

/**
 * Amounts (XNA and assets) travel as decimal strings with 8 decimals
 * ("21000000000.12345678"). Do not convert them to `number`; use the helpers
 * in `lib/utils.ts` (`formatAmount`, `satsOf`, `sumAmounts`).
 */
export type AmountString = string;

export interface Block {
    hash: string;
    height: number;
    time: number;
    size: number;
    txCount: number;
    difficulty: string;
    nonce: number;
    nonce64: number;
    bits: string;
    version: number;
    merkleRoot: string;
    previousBlockHash?: string;
    nextBlockHash?: string;
    confirmations: number;
    /** Full transactions (`/api/block/[id]`) */
    tx: Transaction[];
    // Pagination (when applicable)
    page?: number;
    totalPages?: number;
    itemsOnPage?: number;
    // Legacy field names (for API compatibility)
    /** @deprecated Use merkleRoot instead */
    merkleroot?: string;
    /** @deprecated Use previousBlockHash instead */
    previousblockhash?: string;
    /** @deprecated Use nextBlockHash instead */
    nextblockhash?: string;
}

/** Block as returned by `/api/blocks` (listing): the header, txids only. */
export type BlockSummary = Omit<Block, 'tx' | 'confirmations'> & {
    tx?: string[];
    confirmations?: number;
};

// ============================================
// Transaction Types
// ============================================

export interface Transaction {
    txid: string;
    version: number;
    lockTime: number;
    size: number;
    vsize: number;
    height: number;
    blocktime: number;
    blockhash?: string;
    confirmations?: number;
    vin: TransactionInput[];
    vout: TransactionOutput[];
    /** Inputs minus outputs (exact, from the syncer); undefined when an input value is unknown */
    fee?: AmountString;
    /** Sum of the outputs (exact, from the syncer) */
    totalOutput?: AmountString;
    hex?: string;
    // Present in an address history: what that address moved in this tx
    /** XNA received by the address */
    received?: AmountString;
    /** XNA spent by the address */
    sent?: AmountString;
    /** Asset units moved by the address (+ received, - sent) */
    assetDeltas?: AssetDelta[];
}

export interface AssetDelta {
    asset: string;
    delta: AmountString;
}

export interface TransactionInput {
    txid?: string;
    vout?: number;
    sequence: number;
    n: number;
    addresses?: string[];
    isAddress: boolean;
    /** Value of the spent output (enriched by the syncer) */
    value?: AmountString;
    coinbase?: string;
}

export interface TransactionOutput {
    value: AmountString;
    n: number;
    hex?: string;
    addresses: string[];
    isAddress: boolean;
    spent?: boolean;
    scriptPubKey?: ScriptPubKey;
}

/** Asset carried by an output (as in the node's `scriptPubKey.asset`) */
export interface ScriptAsset {
    name: string;
    amount: AmountString;
    units?: number;
    reissuable?: number;
    hasIPFS?: number;
    ipfs_hash?: string;
}

export interface ScriptPubKey {
    asm: string;
    hex: string;
    type: string;
    addresses?: string[];
    asset?: ScriptAsset;
}

// ============================================
// Address Types
// ============================================

export interface Address {
    address: string;
    balance: AmountString;
    totalReceived: AmountString;
    totalSent: AmountString;
    unconfirmedBalance?: string;
    unconfirmedTxs?: number;
    txs: number;
    txids?: string[];
    transactions?: Transaction[];
    tokens?: Token[];
    // Pagination
    page?: number;
    totalPages?: number;
    itemsOnPage?: number;
}

export interface Token {
    type: string;
    name: string;
    contract?: string;
    transfers: number;
    symbol: string;
    decimals: number;
    balance: string;
}

export interface RichListEntry {
    address: string;
    balance: AmountString;
    totalReceived: AmountString;
    totalSent: AmountString;
    txCount: number;
}

// ============================================
// Network Types
// ============================================

export interface Peer {
    id: number;
    addr: string;
    addrlocal?: string;
    services: string;
    relaytxes: boolean;
    lastsend: number;
    lastrecv: number;
    bytessent: number;
    bytesrecv: number;
    conntime: number;
    timeoffset: number;
    pingtime: number;
    minping?: number;
    version: number;
    subver: string;
    inbound: boolean;
    addnode: boolean;
    startingheight: number;
    banscore: number;
    syncedHeaders: number;
    syncedBlocks: number;
    whitelisted: boolean;
    // Legacy field names (for API compatibility)
    /** @deprecated Use syncedHeaders instead */
    synced_headers?: number;
    /** @deprecated Use syncedBlocks instead */
    synced_blocks?: number;
}

export interface NetworkStats {
    difficulty: number;
    hashrate: number;
    connections: number;
    height: number;
    supply: number;
    priceUsd: number;
    marketCapUsd: number;
}

// ============================================
// Asset Types
// ============================================

export interface Asset {
    name: string;
    amount: AmountString;
    units: number;
    reissuable: boolean;
    hasIpfs: boolean;
    ipfsHash?: string;
    txid: string;
    blockHeight: number;
    type: string;
    time?: number;
}

export interface AddressAsset {
    asset: string;
    balance: AmountString;
    units?: number;
}

// ============================================
// Statistics Types
// ============================================

export interface DailyStats {
    date: string;
    txCount: number;
    totalOutput: number;
    sumDifficulty: number;
    blockCount: number;
    newAssetsCount: number;
    activeAddressCount: number;
    sumBlockSize: number;
    newSupply: number;
    burnedCoins: number;
}

// ============================================
// System Info Types
// ============================================

export interface SystemInfo {
    blockbook: BlockbookInfo;
    backend: BackendInfo;
}

export interface BlockbookInfo {
    coin: string;
    host: string;
    version: string;
    gitCommit: string;
    buildTime: string;
    syncMode: boolean;
    initialSync: boolean;
    inSync: boolean;
    bestHeight: number;
    lastBlockTime: string;
    inSyncMempool: boolean;
    lastMempoolTime: string;
    mempoolSize: number;
    decimals: number;
    dbSize: number;
    about: string;
}

export interface BackendInfo {
    chain: string;
    blocks: number;
    headers: number;
    bestBlockHash: string;
    difficulty: string;
    sizeOnDisk: number;
    version: string;
    subversion: string;
    protocolVersion: string;
    hashrate: number;
    supply: number;
    marketCap: number;
    price: number;
}
