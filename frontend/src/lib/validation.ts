/**
 * Input validation utilities for API routes and components
 */

export const LIMITS = {
    PAGINATION_MIN: 1,
    PAGINATION_MAX: 100,
    PAGINATION_DEFAULT: 20,
    RICHLIST_MAX: 500,
    SKIP_MAX: 100000,
    INPUT_MAX_LENGTH: 256,
    BLOCK_HEIGHT_MAX: 100_000_000,
} as const;

/**
 * Validate and sanitize pagination parameters
 */
export function validatePaginationParams(searchParams: URLSearchParams, defaults?: {
    limit?: number;
    maxLimit?: number;
}): { limit: number; skip: number } {
    const defaultLimit = defaults?.limit ?? LIMITS.PAGINATION_DEFAULT;
    const maxLimit = defaults?.maxLimit ?? LIMITS.PAGINATION_MAX;

    const rawLimit = parseInt(searchParams.get('limit') || String(defaultLimit), 10);
    const rawSkip = parseInt(searchParams.get('skip') || '0', 10);

    return {
        limit: Math.min(Math.max(isNaN(rawLimit) ? defaultLimit : rawLimit, LIMITS.PAGINATION_MIN), maxLimit),
        skip: Math.min(Math.max(isNaN(rawSkip) ? 0 : rawSkip, 0), LIMITS.SKIP_MAX),
    };
}

/**
 * Sanitize user input by removing potentially dangerous characters
 */
export function sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') return '';
    return input
        .replace(/[<>\"'&]/g, '')
        .trim()
        .slice(0, LIMITS.INPUT_MAX_LENGTH);
}

/**
 * Validate transaction ID format (64 hex characters)
 */
export function isValidTxid(txid: string): boolean {
    if (!txid || typeof txid !== 'string') return false;
    return /^[a-fA-F0-9]{64}$/.test(txid);
}

/**
 * Validate block hash format (64 hex characters)
 */
export function isValidBlockHash(hash: string): boolean {
    if (!hash || typeof hash !== 'string') return false;
    return /^[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Validate blockchain address format
 * Supports typical base58 addresses (26-35 chars alphanumeric)
 */
export function isValidAddress(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    return /^[a-zA-Z0-9]{26,35}$/.test(address);
}

/**
 * Validate block height
 */
export function isValidBlockHeight(height: string | number): boolean {
    const num = typeof height === 'string' ? parseInt(height, 10) : height;
    return !isNaN(num) && num >= 0 && num <= LIMITS.BLOCK_HEIGHT_MAX;
}

/**
 * Validate and parse a numeric parameter
 */
export function parseNumericParam(value: string | null, defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return defaultValue;
    return Math.min(Math.max(parsed, min), max);
}

/**
 * Determine search query type
 */
export type SearchQueryType = 'block_height' | 'hash' | 'address' | 'invalid';

export function getSearchQueryType(query: string): SearchQueryType {
    const sanitized = sanitizeInput(query);
    if (!sanitized) return 'invalid';

    // Block height (numeric)
    if (/^\d+$/.test(sanitized)) {
        const height = parseInt(sanitized, 10);
        if (height >= 0 && height <= LIMITS.BLOCK_HEIGHT_MAX) {
            return 'block_height';
        }
        return 'invalid';
    }

    // 64-char hex (txid or block hash)
    if (/^[a-fA-F0-9]{64}$/.test(sanitized)) {
        return 'hash';
    }

    // Address format
    if (isValidAddress(sanitized)) {
        return 'address';
    }

    return 'invalid';
}
