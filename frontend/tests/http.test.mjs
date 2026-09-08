import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ApiError,
    TimeoutError,
    fetchJson,
    isRetryableError,
    getRetryDelayMs,
    parseRetryAfter,
} from '../src/lib/http.ts';

const json = (body, init = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

/** fetch stub that rejects with AbortError when its signal fires, like a real fetch */
const hanging = () => (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

test('parses a 200 body', async () => {
    const data = await fetchJson('http://x/ok', { fetchImpl: async () => json({ a: 1 }) });
    assert.deepEqual(data, { a: 1 });
});

test('non-2xx becomes ApiError with the status', async () => {
    await assert.rejects(
        fetchJson('http://x/500', { fetchImpl: async () => json({}, { status: 500, statusText: 'Boom' }) }),
        (e) => e instanceof ApiError && e.status === 500,
    );
});

test('429 carries Retry-After and drives the retry delay', async () => {
    let err;
    try {
        await fetchJson('http://x/429', {
            fetchImpl: async () => json({}, { status: 429, headers: { 'retry-after': '7' } }),
        });
    } catch (e) { err = e; }
    assert.ok(err instanceof ApiError);
    assert.equal(err.retryAfterMs, 7000);
    assert.equal(isRetryableError(err), true);
    assert.equal(getRetryDelayMs(0, err), 7000);
    assert.equal(getRetryDelayMs(0, err, 1000, 5000), 5000, 'Retry-After is capped');
});

test('parseRetryAfter handles seconds and HTTP dates', () => {
    assert.equal(parseRetryAfter('120'), 120000);
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter('garbage'), undefined);
    const now = Date.parse('2026-09-08T10:00:00Z');
    assert.equal(parseRetryAfter('Tue, 08 Sep 2026 10:00:30 GMT', now), 30000);
    assert.equal(parseRetryAfter('Tue, 08 Sep 2026 09:00:00 GMT', now), 0, 'past dates never go negative');
});

test('the timeout covers the request', async () => {
    await assert.rejects(
        fetchJson('http://x/slow', { timeoutMs: 20, fetchImpl: hanging() }),
        (e) => e instanceof TimeoutError && isRetryableError(e),
    );
});

test('the timeout also covers reading the body', async () => {
    const fetchImpl = async (_url, { signal }) => ({
        ok: true, status: 200, statusText: 'OK', headers: new Headers(),
        json: () => new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    await assert.rejects(
        fetchJson('http://x/slow-body', { timeoutMs: 20, fetchImpl }),
        (e) => e instanceof TimeoutError,
    );
});

test('caller cancellation is propagated as AbortError and is not retryable', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(
        fetchJson('http://x/cancel', { timeoutMs: 1000, signal: controller.signal, fetchImpl: hanging() }),
        (e) => e.name === 'AbortError' && !isRetryableError(e),
    );
});

test('an already-aborted signal never issues the request', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await assert.rejects(
        fetchJson('http://x/pre', { signal: controller.signal, fetchImpl: async () => { called = true; return json({}); } }),
        (e) => e.name === 'AbortError',
    );
    assert.equal(called, false);
});

test('retry policy: 4xx is final, 5xx/429/timeouts/network errors are retryable', () => {
    assert.equal(isRetryableError(new ApiError(400, 'bad')), false);
    assert.equal(isRetryableError(new ApiError(404, 'nf')), false);
    assert.equal(isRetryableError(new ApiError(429, 'slow down')), true);
    assert.equal(isRetryableError(new ApiError(502, 'bad gw')), true);
    assert.equal(isRetryableError(new TimeoutError('t')), true);
    assert.equal(isRetryableError(new TypeError('fetch failed')), true);
});

test('backoff doubles from the base and is capped', () => {
    const e = new TypeError('fetch failed');
    assert.equal(getRetryDelayMs(0, e), 1000);
    assert.equal(getRetryDelayMs(1, e), 2000);
    assert.equal(getRetryDelayMs(2, e), 4000);
    assert.equal(getRetryDelayMs(10, e), 30000);
    assert.equal(getRetryDelayMs(1, e, 500), 1000);
});
