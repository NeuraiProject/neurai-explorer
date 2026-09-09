/**
 * Dependency-free HTTP helpers shared by the browser API client and tests.
 *
 * Retries are deliberately NOT implemented here. TanStack Query already
 * retries the whole query function, so a fetcher with its own loop multiplies
 * the calls (4 x 4 = 16 requests for one failing endpoint). The single retry
 * policy lives in the QueryClient and uses `isRetryableError`/`getRetryDelayMs`.
 */

export class ApiError extends Error {
    readonly status: number;
    /** From a 429/503 `Retry-After` header, when present */
    readonly retryAfterMs: number | undefined;

    constructor(status: number, message: string, retryAfterMs?: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

export class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}

/** `Retry-After` is either delay-seconds or an HTTP date */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
    if (!header) return undefined;
    const trimmed = header.trim();
    if (/^\d{1,6}$/.test(trimmed)) return Number(trimmed) * 1000;
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return undefined;
    return Math.max(0, at - now);
}

export interface FetchJsonOptions {
    timeoutMs?: number;
    /** Caller cancellation (TanStack Query passes its own per-query signal) */
    signal?: AbortSignal;
    /** Injectable for tests */
    fetchImpl?: typeof fetch;
}

function abortError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    return new DOMException('The operation was aborted', 'AbortError');
}

/**
 * GET a JSON document with a timeout that covers the whole exchange, body
 * included, and that is always cleared, whether fetch resolves or rejects.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
    const { timeoutMs = 10000, signal, fetchImpl = fetch } = options;

    if (signal?.aborted) throw abortError(signal.reason);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        const res = await fetchImpl(url, { signal: controller.signal });
        if (!res.ok) {
            const retryAfterMs = res.status === 429 || res.status === 503
                ? parseRetryAfter(res.headers.get('retry-after'))
                : undefined;
            throw new ApiError(res.status, `API Error: ${res.status} ${res.statusText}`, retryAfterMs);
        }
        // The timer stays armed while the body is read: a stalled body is a timeout too.
        return (await res.json()) as T;
    } catch (error) {
        if (timedOut) throw new TimeoutError(`Request timeout after ${timeoutMs}ms`);
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

/**
 * Retry only what a repeat can fix: 429, 5xx, timeouts and network failures.
 * 4xx answers are final and a cancelled request must never be re-issued.
 */
export function isRetryableError(error: unknown): boolean {
    if (isAbortError(error)) return false;
    if (error instanceof ApiError) {
        if (error.status === 429) return true;
        return error.status >= 500;
    }
    return true;
}

/**
 * Exponential backoff honouring `Retry-After` when the server sent one.
 * `attempt` is zero-based, as TanStack Query passes it.
 */
export function getRetryDelayMs(attempt: number, error: unknown, baseMs = 1000, maxMs = 30000): number {
    if (error instanceof ApiError && error.retryAfterMs !== undefined) {
        return error.retryAfterMs;
    }
    return Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs);
}
