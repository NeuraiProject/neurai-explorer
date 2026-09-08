/**
 * API client for frontend
 * Uses centralized types from @/types
 */

import config from '../config.json';
import { fetchJson } from './http';
import type {
    Block,
    BlockSummary,
    Transaction,
    Address,
    RichListEntry,
    Peer,
    SystemInfo,
} from '@/types';

// Re-export types for convenience
export type {
    Block,
    BlockSummary,
    Transaction,
    Address,
    RichListEntry,
    Peer,
    SystemInfo,
};

// API response type for assets (matches snake_case from API)
export interface ApiAsset {
    name: string;
    /** Decimal string, see AmountString */
    amount: string;
    units: number;
    reissuable: boolean;
    has_ipfs: boolean;
    ipfsHash?: string;
    txid: string;
    blockHeight: number;
    type: string;
    time: number;
}

// Get base URL based on environment
const getBaseUrl = () => {
    if (typeof window !== 'undefined') return config.api.baseUrl;
    // Server-side: use internal API URL from environment
    const internalUrl = process.env.INTERNAL_API_URL;
    if (!internalUrl) {
        // Log warning only in development
        if (process.env.NODE_ENV === 'development') {
            console.warn('INTERNAL_API_URL not set, using relative path');
        }
        return '/api';
    }
    return internalUrl;
};

const API_URL = getBaseUrl();

// API configuration with defaults. `retryAttempts` is the number of Query
// retries (see providers.tsx); the fetcher itself never retries.
const API_CONFIG = {
    timeout: config.api.timeout ?? 10000,
    retryAttempts: config.api.retryAttempts ?? 2,
    retryDelay: config.api.retryDelay ?? 1000,
};

export { ApiError, TimeoutError, isRetryableError, getRetryDelayMs } from './http';

/** Single retry policy, consumed by the QueryClient in providers.tsx */
export const RETRY_POLICY = {
    attempts: API_CONFIG.retryAttempts,
    baseDelayMs: API_CONFIG.retryDelay,
} as const;

export interface RequestOptions {
    /** TanStack Query passes its per-query signal so abandoned requests are cancelled */
    signal?: AbortSignal;
    timeout?: number;
}

/**
 * Generic fetcher: timeout covering the body read, cancellation, typed errors.
 * No retry loop here on purpose, see lib/http.ts.
 */
const fetcher = <T>(endpoint: string, options?: RequestOptions): Promise<T> =>
    fetchJson<T>(`${API_URL}${endpoint}`, {
        timeoutMs: options?.timeout ?? API_CONFIG.timeout,
        signal: options?.signal,
    });

// Pagination limits from config
const MAX_LIMIT = config.ui.pagination?.maxLimit ?? 100;
const DEFAULT_LIMIT = config.ui.pagination?.defaultLimit ?? 20;
const HOMEPAGE_LIMIT = config.ui.pagination?.homepageLimit ?? 10;

/**
 * API client methods
 */
export const api = {
    // System status
    getStatus: (opts?: RequestOptions) => fetcher<SystemInfo>('/status', opts),

    // Block endpoints
    getBlock: (hashOrHeight: string | number, opts?: RequestOptions) => fetcher<Block>(`/block/${hashOrHeight}`, opts),
    getLatestBlocks: (limit = HOMEPAGE_LIMIT, skip = 0, opts?: RequestOptions) =>
        fetcher<BlockSummary[]>(`/blocks?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}`, opts),

    // Transaction endpoints
    getTx: (txid: string, opts?: RequestOptions) => fetcher<Transaction>(`/tx/${txid}`, opts),
    getLatestTxs: (limit = config.ui.latestTxsLimit, skip = 0, minTotalOutput?: number, opts?: RequestOptions) => {
        const minParam = typeof minTotalOutput === 'number' ? `&minTotalOutput=${minTotalOutput}` : '';
        return fetcher<Transaction[]>(`/txs?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}${minParam}`, opts);
    },

    // Address endpoints
    getAddress: (address: string, page = 1, pageSize = config.ui.itemsPerPage, opts?: RequestOptions) =>
        fetcher<Address>(`/address/${address}?page=${page}&pageSize=${Math.min(pageSize, MAX_LIMIT)}`, opts),
    getUtxo: (address: string, opts?: RequestOptions) => fetcher<unknown[]>(`/utxo/${address}`, opts),

    // Rich list
    getRichList: (limit = config.ui.richListLimit, opts?: RequestOptions) =>
        fetcher<RichListEntry[]>(`/richlist?limit=${Math.min(limit, 500)}`, opts),

    // Network
    getPeers: (opts?: RequestOptions) => fetcher<Peer[]>('/peers', opts),

    // Assets
    getLatestAssets: (limit = DEFAULT_LIMIT, skip = 0, opts?: RequestOptions) =>
        fetcher<ApiAsset[]>(`/assets?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}`, opts),
};
