import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as validation from '../src/lib/validation.ts';

const require = createRequire(import.meta.url);

// Exercise the actual routes and page with isolated provider/database dependencies.
function loadSource(path, mocks, globals = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const exports = {};
    runInNewContext(outputText, {
        exports, URL, AbortSignal, console,
        require: (name) => {
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name.startsWith('@/')) throw new Error(`Missing mock: ${name}`);
            return require(name);
        },
        ...globals,
    });
    return exports;
}

function priceRoute(fetch) {
    return loadSource('../src/app/api/[command]/[[...args]]/route.ts', {
        'next/server': { NextResponse: Response },
        '@/lib/db': { networkStats: { findUnique: async () => ({ height: 1 }) } },
        '@/lib/services/block': {},
        '@/lib/services/supply': { getSupply: async () => ({ supply: 1 }) },
        '@/lib/validation': validation,
    }, { fetch }).GET;
}

for (const command of ['getcurrentprice', 'getsummary', 'getbasicstats']) {
    test(`${command} rejects missing prices without returning or caching a zero quote`, async () => {
        const failures = [
            async () => { throw new TypeError('Network unavailable'); },
            async () => { throw new DOMException('Timed out', 'TimeoutError'); },
            async () => new Response('', { status: 429 }),
            async () => new Response('invalid JSON'),
            async () => Response.json({}),
            async () => Response.json({ neurai: { usd: 1 } }),
            async () => Response.json({ neurai: { usd: '1', btc: 1 } }),
        ];
        for (const fetch of failures) {
            const response = await priceRoute(fetch)(new Request(`http://x/api/${command}`), {
                params: Promise.resolve({ command }),
            });
            assert.equal(response.status, 503);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await response.json(), { error: 'Price temporarily unavailable' });
        }
    });
}

test('valid prices, including explicit zero, retain the successful API response', async () => {
    for (const quote of [{ usd: 0.001, btc: 0.00000001 }, { usd: 0, btc: 0 }]) {
        const response = await priceRoute(async (_url, { signal }) => {
            assert.ok(signal instanceof AbortSignal);
            return Response.json({ neurai: quote });
        })(new Request('http://x/api/getcurrentprice'), { params: Promise.resolve({ command: 'getcurrentprice' }) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { last_price_btc: quote.btc, last_price_usd: quote.usd });
    }
});

test('address navigation stops at the last allowed page and rejects deeper pages before querying', async () => {
    let calls = 0;
    const Page = loadSource('../src/app/address/[address]/page.tsx', {
        '@/lib/db': { addressAsset: { findMany: async () => { calls++; return []; } } },
        '@/lib/services/address': { getAddressData: async (address, page) => {
            calls++;
            return { address, page, totalPages: 3000, transactions: [] };
        } },
        '@/lib/validation': validation,
        '@/lib/utils': {},
        '@/components/ui/Card': { Card: ({ children }) => children },
        '@/components/ui/Amount': { Amount: () => null },
        '@/components/TxIdDisplay': {},
        'next/link': ({ href, children }) => require('react').createElement('a', { href }, children),
    }).default;
    const render = async (page) => renderToStaticMarkup(await Page({
        params: Promise.resolve({ address: 'N'.repeat(34) }), searchParams: Promise.resolve({ page: String(page) }),
    }));
    assert.match(await render(2000), /href="[^"]*page=2001"/);
    const last = await render(2001);
    assert.match(last, /Page 2001 of 2001/);
    assert.match(last, /most recent 2,001 pages/);
    assert.doesNotMatch(last, /href="[^"]*page=2002"/);
    const callsBefore = calls;
    assert.match(await render(2002), /not browsable by page/);
    assert.equal(calls, callsBefore);
});
