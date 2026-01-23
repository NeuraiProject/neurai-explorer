/**
 * Data transformation utilities
 * Normalizes API/DB responses to consistent camelCase format
 */

import type {
    Block,
    Transaction,
    TransactionInput,
    TransactionOutput,
    Address,
    RichListEntry,
    Peer,
    Asset,
    DailyStats,
} from '@/types';

/**
 * Normalize raw block data to consistent format
 */
export function normalizeBlock(raw: Record<string, unknown>): Block {
    const txArray = Array.isArray(raw.tx) ? raw.tx : [];

    return {
        hash: raw.hash as string,
        height: raw.height as number,
        time: raw.time as number,
        size: raw.size as number,
        txCount: (raw.txCount ?? raw.tx_count ?? txArray.length ?? 0) as number,
        difficulty: String(raw.difficulty ?? '0'),
        nonce: (raw.nonce ?? 0) as number,
        nonce64: (raw.nonce64 ?? raw.nonce ?? 0) as number,
        bits: (raw.bits ?? '') as string,
        version: (raw.version ?? 0) as number,
        merkleRoot: (raw.merkleRoot ?? raw.merkleroot ?? '') as string,
        previousBlockHash: (raw.previousBlockHash ?? raw.previousblockhash) as string | undefined,
        nextBlockHash: (raw.nextBlockHash ?? raw.nextblockhash) as string | undefined,
        confirmations: (raw.confirmations ?? 0) as number,
        tx: txArray.map((tx: unknown) => normalizeTransaction(tx as Record<string, unknown>)),
        page: raw.page as number | undefined,
        totalPages: raw.totalPages as number | undefined,
        itemsOnPage: raw.itemsOnPage as number | undefined,
    };
}

/**
 * Normalize raw transaction data to consistent format
 */
export function normalizeTransaction(raw: Record<string, unknown>): Transaction {
    const vinArray = Array.isArray(raw.vin) ? raw.vin : [];
    const voutArray = Array.isArray(raw.vout) ? raw.vout : [];

    return {
        txid: raw.txid as string,
        version: (raw.version ?? 0) as number,
        lockTime: (raw.lockTime ?? raw.locktime ?? 0) as number,
        size: (raw.size ?? 0) as number,
        vsize: (raw.vsize ?? raw.size ?? 0) as number,
        height: (raw.height ?? raw.block_height ?? 0) as number,
        blocktime: (raw.blocktime ?? raw.time ?? 0) as number,
        blockhash: raw.blockhash as string | undefined,
        confirmations: raw.confirmations as number | undefined,
        vin: vinArray.map((vin: unknown) => normalizeVin(vin as Record<string, unknown>)),
        vout: voutArray.map((vout: unknown) => normalizeVout(vout as Record<string, unknown>)),
        fee: raw.fee as number | undefined,
        totalOutput: (raw.totalOutput ?? raw.total_output) as number | undefined,
        hex: raw.hex as string | undefined,
    };
}

/**
 * Normalize transaction input
 */
function normalizeVin(raw: Record<string, unknown>): TransactionInput {
    return {
        txid: raw.txid as string | undefined,
        vout: raw.vout as number | undefined,
        sequence: (raw.sequence ?? 0) as number,
        n: (raw.n ?? 0) as number,
        addresses: raw.addresses as string[] | undefined,
        isAddress: (raw.isAddress ?? false) as boolean,
        value: raw.value as string | undefined,
        coinbase: raw.coinbase as string | undefined,
    };
}

/**
 * Normalize transaction output
 */
function normalizeVout(raw: Record<string, unknown>): TransactionOutput {
    const scriptPubKey = raw.scriptPubKey as Record<string, unknown> | undefined;

    return {
        value: String(raw.value ?? '0'),
        n: (raw.n ?? 0) as number,
        hex: raw.hex as string | undefined,
        addresses: (raw.addresses ?? scriptPubKey?.addresses ?? []) as string[],
        isAddress: (raw.isAddress ?? ((scriptPubKey?.addresses as string[] | undefined)?.length ?? 0) > 0) as boolean,
        spent: raw.spent as boolean | undefined,
        scriptPubKey: scriptPubKey ? {
            asm: (scriptPubKey.asm ?? '') as string,
            hex: (scriptPubKey.hex ?? '') as string,
            type: (scriptPubKey.type ?? '') as string,
            addresses: scriptPubKey.addresses as string[] | undefined,
        } : undefined,
    };
}

/**
 * Normalize address data
 */
export function normalizeAddress(raw: Record<string, unknown>): Address {
    const transactions = Array.isArray(raw.transactions)
        ? raw.transactions.map((tx: unknown) => normalizeTransaction(tx as Record<string, unknown>))
        : undefined;

    return {
        address: raw.address as string,
        balance: String(raw.balance ?? '0'),
        totalReceived: String(raw.totalReceived ?? raw.total_received ?? '0'),
        totalSent: String(raw.totalSent ?? raw.total_sent ?? '0'),
        unconfirmedBalance: raw.unconfirmedBalance as string | undefined,
        unconfirmedTxs: raw.unconfirmedTxs as number | undefined,
        txs: (raw.txs ?? raw.txCount ?? raw.tx_count ?? 0) as number,
        txids: raw.txids as string[] | undefined,
        transactions,
        tokens: raw.tokens as Address['tokens'] | undefined,
        page: raw.page as number | undefined,
        totalPages: raw.totalPages as number | undefined,
        itemsOnPage: raw.itemsOnPage as number | undefined,
    };
}

/**
 * Normalize rich list entry
 */
export function normalizeRichListEntry(raw: Record<string, unknown>): RichListEntry {
    return {
        address: raw.address as string,
        balance: String(raw.balance ?? '0'),
        totalReceived: String(raw.totalReceived ?? raw.total_received ?? '0'),
        totalSent: String(raw.totalSent ?? raw.total_sent ?? '0'),
        txCount: (raw.txCount ?? raw.tx_count ?? 0) as number,
    };
}

/**
 * Normalize peer data
 */
export function normalizePeer(raw: Record<string, unknown>): Peer {
    return {
        id: (raw.id ?? 0) as number,
        addr: (raw.addr ?? '') as string,
        addrlocal: raw.addrlocal as string | undefined,
        services: (raw.services ?? '') as string,
        relaytxes: (raw.relaytxes ?? false) as boolean,
        lastsend: (raw.lastsend ?? 0) as number,
        lastrecv: (raw.lastrecv ?? 0) as number,
        bytessent: (raw.bytessent ?? 0) as number,
        bytesrecv: (raw.bytesrecv ?? 0) as number,
        conntime: (raw.conntime ?? 0) as number,
        timeoffset: (raw.timeoffset ?? 0) as number,
        pingtime: (raw.pingtime ?? 0) as number,
        minping: raw.minping as number | undefined,
        version: (raw.version ?? 0) as number,
        subver: (raw.subver ?? '') as string,
        inbound: (raw.inbound ?? false) as boolean,
        addnode: (raw.addnode ?? false) as boolean,
        startingheight: (raw.startingheight ?? 0) as number,
        banscore: (raw.banscore ?? 0) as number,
        syncedHeaders: (raw.syncedHeaders ?? raw.synced_headers ?? 0) as number,
        syncedBlocks: (raw.syncedBlocks ?? raw.synced_blocks ?? 0) as number,
        whitelisted: (raw.whitelisted ?? false) as boolean,
    };
}

/**
 * Normalize asset data
 */
export function normalizeAsset(raw: Record<string, unknown>): Asset {
    return {
        name: (raw.name ?? '') as string,
        amount: (raw.amount ?? 0) as number,
        units: (raw.units ?? 0) as number,
        reissuable: (raw.reissuable ?? false) as boolean,
        hasIpfs: (raw.hasIpfs ?? raw.has_ipfs ?? false) as boolean,
        ipfsHash: (raw.ipfsHash ?? raw.ipfs_hash) as string | undefined,
        txid: (raw.txid ?? '') as string,
        blockHeight: (raw.blockHeight ?? raw.block_height ?? 0) as number,
        type: (raw.type ?? '') as string,
        time: raw.time as number | undefined,
    };
}

/**
 * Normalize daily statistics
 */
export function normalizeDailyStats(raw: Record<string, unknown>): DailyStats {
    const dateValue = raw.date;
    const dateString = typeof dateValue === 'string'
        ? dateValue
        : (dateValue instanceof Date ? dateValue.toISOString().split('T')[0] : '');

    return {
        date: dateString,
        txCount: (raw.txCount ?? raw.tx_count ?? 0) as number,
        totalOutput: parseFloat(String(raw.totalOutput ?? raw.total_output ?? 0)),
        sumDifficulty: parseFloat(String(raw.sumDifficulty ?? raw.sum_difficulty ?? 0)),
        blockCount: (raw.blockCount ?? raw.block_count ?? 0) as number,
        newAssetsCount: (raw.newAssetsCount ?? raw.new_assets_count ?? 0) as number,
        activeAddressCount: (raw.activeAddressCount ?? raw.active_address_count ?? 0) as number,
        sumBlockSize: parseInt(String(raw.sumBlockSize ?? raw.sum_block_size ?? 0), 10),
        newSupply: parseFloat(String(raw.newSupply ?? raw.new_supply ?? 0)),
        burnedCoins: parseFloat(String(raw.burnedCoins ?? raw.burned_coins ?? 0)),
    };
}
