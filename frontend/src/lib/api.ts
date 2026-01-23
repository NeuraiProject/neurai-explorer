/**
 * API client for frontend
 * Uses centralized types from @/types
 */

import config from '../config.json';
import type {
    Block,
    Transaction,
    Address,
    RichListEntry,
    Peer,
    SystemInfo,
} from '@/types';

// Re-export types for convenience
export type {
    Block,
    Transaction,
    Address,
    RichListEntry,
    Peer,
    SystemInfo,
};

// API response type for assets (matches snake_case from API)
export interface ApiAsset {
    name: string;
    amount: number;
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

// API configuration with defaults
const API_CONFIG = {
    timeout: config.api.timeout ?? 10000,
    retryAttempts: config.api.retryAttempts ?? 3,
    retryDelay: config.api.retryDelay ?? 1000,
};

/**
 * Custom API error with status code
 */
export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Sleep utility for retry delay
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generic fetcher with timeout, retry, and error handling
 */
const fetcher = async <T>(
    endpoint: string,
    options?: {
        timeout?: number;
        retries?: number;
    }
): Promise<T> => {
    const {
        timeout = API_CONFIG.timeout,
        retries = API_CONFIG.retryAttempts,
    } = options ?? {};

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const res = await fetch(`${API_URL}${endpoint}`, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                throw new ApiError(res.status, `API Error: ${res.status} ${res.statusText}`);
            }

            return res.json();
        } catch (error) {
            lastError = error as Error;

            // Don't retry on 4xx client errors
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                throw error;
            }

            // Don't retry on abort (timeout)
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }

            // Retry with exponential backoff
            if (attempt < retries) {
                await sleep(API_CONFIG.retryDelay * (attempt + 1));
            }
        }
    }

    throw lastError || new Error('Unknown API error');
};

// Pagination limits from config
const MAX_LIMIT = config.ui.pagination?.maxLimit ?? 100;
const DEFAULT_LIMIT = config.ui.pagination?.defaultLimit ?? 20;
const HOMEPAGE_LIMIT = config.ui.pagination?.homepageLimit ?? 10;

/**
 * API client methods
 */
export const api = {
    // System status
    getStatus: () => fetcher<SystemInfo>('/status'),

    // Block endpoints
    getBlock: (hashOrHeight: string | number) => fetcher<Block>(`/block/${hashOrHeight}`),
    getLatestBlocks: (limit = HOMEPAGE_LIMIT, skip = 0) =>
        fetcher<Block[]>(`/blocks?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}`),

    // Transaction endpoints
    getTx: (txid: string) => fetcher<Transaction>(`/tx/${txid}`),
    getLatestTxs: (limit = config.ui.latestTxsLimit, skip = 0, minTotalOutput?: number) => {
        const minParam = typeof minTotalOutput === 'number' ? `&minTotalOutput=${minTotalOutput}` : '';
        return fetcher<Transaction[]>(`/txs?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}${minParam}`);
    },

    // Address endpoints
    getAddress: (address: string, page = 1, pageSize = config.ui.itemsPerPage) =>
        fetcher<Address>(`/address/${address}?page=${page}&pageSize=${Math.min(pageSize, MAX_LIMIT)}`),
    getUtxo: (address: string) => fetcher<unknown[]>(`/utxo/${address}`),

    // Rich list
    getRichList: (limit = config.ui.richListLimit) =>
        fetcher<RichListEntry[]>(`/richlist?limit=${Math.min(limit, 500)}`),

    // Network
    getPeers: () => fetcher<Peer[]>('/peers'),

    // Assets
    getLatestAssets: (limit = DEFAULT_LIMIT, skip = 0) =>
        fetcher<ApiAsset[]>(`/assets?limit=${Math.min(limit, MAX_LIMIT)}&skip=${skip}`),
};
