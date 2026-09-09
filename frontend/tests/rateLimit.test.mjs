import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from '../src/lib/rateLimit.ts';

const req = (headers) => new Request('http://x/', { headers });

test('X-Real-IP (set by our nginx) wins over everything', () => {
    assert.equal(getClientIp(req({
        'x-real-ip': '203.0.113.9',
        'cf-connecting-ip': '198.51.100.1',
        'x-forwarded-for': '10.0.0.1, 203.0.113.9',
    })), '203.0.113.9');
});

test('CF-Connecting-IP is the next trusted source', () => {
    assert.equal(getClientIp(req({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' })), '198.51.100.1');
});

test('only the LAST X-Forwarded-For hop is trusted, never the client-supplied first one', () => {
    assert.equal(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' })), '203.0.113.9');
    assert.equal(getClientIp(req({ 'x-forwarded-for': ' 203.0.113.9 ' })), '203.0.113.9');
    assert.equal(getClientIp(req({ 'x-forwarded-for': ' , ' })), 'anonymous');
});

test('no headers -> anonymous', () => {
    assert.equal(getClientIp(req({})), 'anonymous');
});

test('a blocked local request tells the HTTP client to wait until the window resets', async (t) => {
    const { rateLimit, getRateLimitHeaders } = await import('../src/lib/rateLimit.ts');
    const { fetchJson, getRetryDelayMs, ApiError } = await import('../src/lib/http.ts');
    t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
    const key = 'retry-after-regression';
    assert.equal(rateLimit(key, 1, 120000), true);
    assert.equal(getRateLimitHeaders(key, 1)['Retry-After'], undefined);
    assert.equal(rateLimit(key, 1, 120000), false);
    t.mock.timers.tick(500);
    const headers = getRateLimitHeaders(key, 1, true);
    assert.equal(headers['Retry-After'], '120');
    await assert.rejects(fetchJson('http://x/limited', {
        fetchImpl: async () => new Response('{}', { status: 429, headers }),
    }), (error) => error instanceof ApiError && getRetryDelayMs(0, error) === 120000);
    t.mock.timers.tick(119500);
    assert.equal(rateLimit(key, 1, 120000), true, 'the exact reset boundary starts a new window');
    t.mock.timers.tick(120001);
    assert.equal(getRateLimitHeaders(key, 1)['X-RateLimit-Reset'], '0');
});
