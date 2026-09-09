import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/lib/services/dailyStats.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loader(findMany) {
    const exports = {};
    runInNewContext(source, {
        exports,
        require: name => {
            if (name === '@/lib/db') return { dailyStats: { findMany } };
            if (name === 'next/cache') return { unstable_cache: (fn, _keys, opts) => {
                assert.equal(opts.revalidate, 60);
                return fn; // Test loading/coalescing; production cache semantics are tested in Docker.
            } };
            throw new Error(`Unexpected import: ${name}`);
        },
    });
    return exports.getDailyStats;
}

test('concurrent loads share one query and return serializable statistics', async () => {
    let calls = 0;
    const get = loader(async options => {
        calls++;
        assert.equal(options.take, 365);
        return [{ date: new Date('2026-01-01'), txCount: 3, totalOutput: '1.5', sumDifficulty: '2',
            blockCount: 2, newAssetsCount: 1, activeAddressCount: 1, burnedCoins: '0', sumBlockSize: 4n, newSupply: '5' }];
    });
    const values = await Promise.all(Array.from({ length: 20 }, () => get()));
    assert.equal(calls, 1);
    assert.equal(values[0][0].date, '2026-01-01T00:00:00.000Z');
    assert.equal(values[0][0].sum_block_size, 4);
    assert.equal(values[0][0].total_output, 1.5);
    assert.doesNotThrow(() => JSON.stringify(values));
});

test('failed refreshes reject instead of caching empty results and permit a later retry', async () => {
    let calls = 0;
    const get = loader(async () => {
        calls++;
        if (calls === 1) throw new Error('Database unavailable');
        return [];
    });
    const failures = await Promise.allSettled([get(), get()]);
    assert.ok(failures.every(result => result.status === 'rejected'));
    assert.equal(calls, 1);
    assert.equal((await get()).length, 0);
    assert.equal(calls, 2);
});
