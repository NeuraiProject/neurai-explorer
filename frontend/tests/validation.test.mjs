import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIMITS,
    InvalidParamError,
    parseIntParam,
    parseOffsetParam,
    parseSizeParam,
    parseDecimalParam,
    assertPagination,
    parsePageParams,
    parseBlockId,
} from '../src/lib/validation.ts';

const throwsParam = (fn, param) =>
    assert.throws(fn, (e) => e instanceof InvalidParamError && e.param === param);

test('transaction batches are capped at 1000 rows', () => {
    assert.equal(LIMITS.TX_BATCH_MAX, 1000);
    assert.equal(parseSizeParam('length', '100000', 50, LIMITS.TX_BATCH_MAX), 1000);
    assert.equal(parseSizeParam('length', '1000', 50, LIMITS.TX_BATCH_MAX), 1000);
    assert.equal(parseSizeParam('length', '999', 50, LIMITS.TX_BATCH_MAX), 999);
    assert.equal(parseSizeParam('length', undefined, 50, LIMITS.TX_BATCH_MAX), 50);
});

test('parseIntParam accepts only plain integers', () => {
    const opts = { min: 0, max: 100 };
    assert.equal(parseIntParam('n', '42', opts), 42);
    assert.equal(parseIntParam('n', '007', opts), 7);
    for (const bad of ['123abc', '1e3', '1.5', '+5', ' 5', '5 ', 'abc', 'Infinity', 'NaN', '0x10']) {
        throwsParam(() => parseIntParam('n', bad, opts), 'n');
    }
});

test('parseIntParam: missing value uses the default or fails', () => {
    assert.equal(parseIntParam('n', null, { default: 9, min: 0, max: 100 }), 9);
    assert.equal(parseIntParam('n', '', { default: 9, min: 0, max: 100 }), 9);
    throwsParam(() => parseIntParam('n', undefined, { min: 0, max: 100 }), 'n');
});

test('parseIntParam: below min always fails, above max clamps only when asked', () => {
    throwsParam(() => parseIntParam('n', '-1', { min: 0, max: 100 }), 'n');
    throwsParam(() => parseIntParam('n', '101', { min: 0, max: 100 }), 'n');
    assert.equal(parseIntParam('n', '101', { min: 0, max: 100, clampMax: true }), 100);
    throwsParam(() => parseIntParam('n', '99999999999999999999', { min: 0, max: 100, clampMax: true }), 'n');
});

test('offsets never clamp: deep history must be an explicit error', () => {
    assert.equal(parseOffsetParam('start', undefined), 0);
    assert.equal(parseOffsetParam('start', String(LIMITS.SKIP_MAX)), LIMITS.SKIP_MAX);
    throwsParam(() => parseOffsetParam('start', String(LIMITS.SKIP_MAX + 1)), 'start');
    throwsParam(() => parseOffsetParam('start', '-5'), 'start');
});

test('parseDecimalParam accepts non-negative decimals only', () => {
    assert.equal(parseDecimalParam('min', undefined, 0), 0);
    assert.equal(parseDecimalParam('min', '100', 0), 100);
    assert.equal(parseDecimalParam('min', '0.5', 0), 0.5);
    for (const bad of ['-1', '1e9', 'abc', 'Infinity', '.5', '5.', '1,5']) {
        throwsParam(() => parseDecimalParam('min', bad, 0), 'min');
    }
});

test('assertPagination bounds the computed offset, not just the page number', () => {
    assert.deepEqual(assertPagination(1, 50), { page: 1, pageSize: 50, offset: 0 });
    // page 2001 * 50 = exactly SKIP_MAX -> allowed
    assert.equal(assertPagination(2001, 50).offset, LIMITS.SKIP_MAX);
    // one page further is beyond the limit even though `page` itself is "small"
    throwsParam(() => assertPagination(2002, 50), 'page');
    throwsParam(() => assertPagination(0, 50), 'page');
    throwsParam(() => assertPagination(1.5, 50), 'page');
    throwsParam(() => assertPagination(1, 0), 'pageSize');
    throwsParam(() => assertPagination(1, LIMITS.PAGINATION_MAX + 1), 'pageSize');
});

test('parsePageParams reads ?page=&pageSize= strictly', () => {
    assert.deepEqual(parsePageParams(new URLSearchParams('')), { page: 1, pageSize: 50, offset: 0 });
    assert.deepEqual(parsePageParams(new URLSearchParams('page=3&pageSize=500')), { page: 3, pageSize: 100, offset: 200 });
    throwsParam(() => parsePageParams(new URLSearchParams('page=abc')), 'page');
    throwsParam(() => parsePageParams(new URLSearchParams('page=-1')), 'page');
    throwsParam(() => parsePageParams(new URLSearchParams('page=99999999')), 'page');
});

test('parseBlockId rejects prefixes that parseInt would have accepted', () => {
    const hash = 'a'.repeat(64);
    assert.deepEqual(parseBlockId(hash), { hash });
    assert.deepEqual(parseBlockId('123'), { height: 123 });
    assert.deepEqual(parseBlockId('0'), { height: 0 });
    assert.deepEqual(parseBlockId(String(LIMITS.BLOCK_HEIGHT_MAX)), { height: LIMITS.BLOCK_HEIGHT_MAX });
    for (const bad of ['123abc', '', '-1', '1.0', 'g'.repeat(64), 'a'.repeat(63), String(LIMITS.BLOCK_HEIGHT_MAX + 1), '1234567890']) {
        assert.equal(parseBlockId(bad), null, bad);
    }
});
