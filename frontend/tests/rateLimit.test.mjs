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
