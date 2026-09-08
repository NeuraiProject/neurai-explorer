/**
 * Input validation utilities for API routes and components
 */

export const LIMITS = {
    PAGINATION_MIN: 1,
    PAGINATION_MAX: 100,
    PAGINATION_DEFAULT: 20,
    RICHLIST_MAX: 500,
    /** Deepest offset any listing may reach; deeper history needs cursors */
    SKIP_MAX: 100000,
    /** Most transactions one Iquidus-style history call (getaddresstxs) may return */
    TX_BATCH_MAX: 1000,
    INPUT_MAX_LENGTH: 256,
    BLOCK_HEIGHT_MAX: 100_000_000,
} as const;

/**
 * Thrown by the strict parsers below. API routes map it to a 400 response and
 * pages to an explicit "invalid parameter" state, without touching the DB.
 */
export class InvalidParamError extends Error {
    readonly param: string;

    constructor(param: string, message: string) {
        super(message);
        this.name = 'InvalidParamError';
        this.param = param;
    }
}

export interface IntParamOptions {
    /** Value used when the parameter is absent; without it, absence is an error */
    default?: number;
    min: number;
    max: number;
    /**
     * Sizes (limit/length/pageSize) clamp to `max` so existing clients asking
     * for more keep working. Offsets never clamp: silently moving the window
     * would return the wrong rows.
     */
    clampMax?: boolean;
}

/**
 * Parse a strict integer: ASCII digits only (optional leading '-'), no
 * prefixes like "123abc", no NaN, no floats, within the safe-integer range.
 */
export function parseIntParam(name: string, raw: string | null | undefined, opts: IntParamOptions): number {
    if (raw === null || raw === undefined || raw === '') {
        if (opts.default !== undefined) return opts.default;
        throw new InvalidParamError(name, `Missing ${name}`);
    }
    if (!/^-?\d{1,16}$/.test(raw)) {
        throw new InvalidParamError(name, `Invalid ${name}: must be an integer`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
        throw new InvalidParamError(name, `Invalid ${name}: out of range`);
    }
    if (value < opts.min) {
        throw new InvalidParamError(name, `Invalid ${name}: must be >= ${opts.min}`);
    }
    if (value > opts.max) {
        if (opts.clampMax) return opts.max;
        throw new InvalidParamError(name, `Invalid ${name}: must be <= ${opts.max}`);
    }
    return value;
}

/** Row offset: 0..SKIP_MAX, never clamped */
export function parseOffsetParam(name: string, raw: string | null | undefined, defaultValue = 0): number {
    return parseIntParam(name, raw, { default: defaultValue, min: 0, max: LIMITS.SKIP_MAX });
}

/** Page size / batch length: 1..max, clamped to max */
export function parseSizeParam(name: string, raw: string | null | undefined, defaultValue: number, max: number): number {
    return parseIntParam(name, raw, { default: defaultValue, min: 1, max, clampMax: true });
}

/**
 * Non-negative decimal amount such as the `min` of getlasttxs. Accepts
 * "100", "0.5"; rejects "-1", "1e9", "abc", "Infinity".
 */
export function parseDecimalParam(name: string, raw: string | null | undefined, defaultValue: number): number {
    if (raw === null || raw === undefined || raw === '') return defaultValue;
    if (!/^\d{1,20}(\.\d{1,12})?$/.test(raw)) {
        throw new InvalidParamError(name, `Invalid ${name}: must be a non-negative number`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new InvalidParamError(name, `Invalid ${name}: out of range`);
    }
    return value;
}

export interface PageParams {
    page: number;
    pageSize: number;
    /** (page - 1) * pageSize, guaranteed <= SKIP_MAX */
    offset: number;
}

/**
 * Bound the offset a page-based listing computes, not just the page number:
 * page=2000 with pageSize=50 is exactly as deep as page=100000 with pageSize=1.
 */
export function assertPagination(page: number, pageSize: number): PageParams {
    if (!Number.isSafeInteger(page) || page < 1) {
        throw new InvalidParamError('page', 'Invalid page: must be >= 1');
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > LIMITS.PAGINATION_MAX) {
        throw new InvalidParamError('pageSize', `Invalid pageSize: must be 1..${LIMITS.PAGINATION_MAX}`);
    }
    const offset = (page - 1) * pageSize;
    if (offset > LIMITS.SKIP_MAX) {
        throw new InvalidParamError('page', `Invalid page: history beyond ${LIMITS.SKIP_MAX} rows is not browsable by page`);
    }
    return { page, pageSize, offset };
}

/** `?page=&pageSize=` for address-style listings */
export function parsePageParams(searchParams: URLSearchParams, defaults?: { pageSize?: number }): PageParams {
    const page = parseIntParam('page', searchParams.get('page'), { default: 1, min: 1, max: Number.MAX_SAFE_INTEGER });
    const pageSize = parseSizeParam('pageSize', searchParams.get('pageSize'), defaults?.pageSize ?? 50, LIMITS.PAGINATION_MAX);
    return assertPagination(page, pageSize);
}

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
 * Strict block locator: a 64-hex hash or a plain decimal height. Unlike
 * `parseInt`, "123abc" is rejected instead of being read as height 123.
 */
export function parseBlockId(id: string): { hash: string } | { height: number } | null {
    if (!id || typeof id !== 'string') return null;
    if (isValidBlockHash(id)) return { hash: id };
    if (/^\d{1,9}$/.test(id)) {
        const height = Number(id);
        if (height <= LIMITS.BLOCK_HEIGHT_MAX) return { height };
    }
    return null;
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
