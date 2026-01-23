/**
 * Centralized type definitions for the frontend
 * All types use consistent camelCase naming
 */

// ============================================
// Block Types
// ============================================

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
    fee?: number;
    totalOutput?: number;
    hex?: string;
}

export interface TransactionInput {
    txid?: string;
    vout?: number;
    sequence: number;
    n: number;
    addresses?: string[];
    isAddress: boolean;
    value?: string;
    coinbase?: string;
}

export interface TransactionOutput {
    value: string;
    n: number;
    hex?: string;
    addresses: string[];
    isAddress: boolean;
    spent?: boolean;
    scriptPubKey?: ScriptPubKey;
}

export interface ScriptPubKey {
    asm: string;
    hex: string;
    type: string;
    addresses?: string[];
}

// ============================================
// Address Types
// ============================================

export interface Address {
    address: string;
    balance: string;
    totalReceived: string;
    totalSent: string;
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
    balance: string;
    totalReceived: string;
    totalSent: string;
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
    amount: number;
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
    balance: number;
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
