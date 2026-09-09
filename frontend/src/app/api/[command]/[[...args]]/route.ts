import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getBlockJson } from '@/lib/services/block';
import { getDistribution, getSupply } from '@/lib/services/supply';
import {
    InvalidParamError,
    LIMITS,
    isValidAddress,
    isValidBlockHash,
    isValidTxid,
    parseDecimalParam,
    parseIntParam,
    parseOffsetParam,
    parseSizeParam,
} from '@/lib/validation';

// We removed rpcCall import. Everything must come from DB or external APIs (e.g. coingecko)

const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=neurai&vs_currencies=usd,btc';
const PRICE_TIMEOUT_MS = 5000;
type PriceQuote = { neurai: { usd: number; btc: number } };

class PriceUnavailableError extends Error {
    constructor() {
        super('Price temporarily unavailable');
        this.name = 'PriceUnavailableError';
    }
}

/** Bound provider latency and never represent a missing quote as a zero price. */
async function fetchPrice(): Promise<PriceQuote> {
    try {
        const res = await fetch(PRICE_URL, { signal: AbortSignal.timeout(PRICE_TIMEOUT_MS) });
        if (!res.ok) throw new PriceUnavailableError();
        const data = await res.json();
        const quote = data?.neurai;
        if (!quote || typeof quote.usd !== 'number' || !Number.isFinite(quote.usd) || quote.usd < 0
            || typeof quote.btc !== 'number' || !Number.isFinite(quote.btc) || quote.btc < 0) {
            throw new PriceUnavailableError();
        }
        return data as PriceQuote;
    } catch {
        throw new PriceUnavailableError();
    }
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ command: string; args?: string[] }> }
) {
    const { command, args: rawArgs } = await params;
    const args = rawArgs || [];
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams);

    try {
        switch (command) {
            // --- Standard Commands (Now via DB) ---
            case 'getdifficulty': {
                const stats = await prisma.networkStats.findUnique({ where: { id: 1 } });
                const diff = stats?.difficulty || 0;
                return new NextResponse(diff.toString(), { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getconnectioncount': {
                const stats = await prisma.networkStats.findUnique({ where: { id: 1 } });
                const count = stats?.connections || 0;
                return new NextResponse(count.toString(), { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getblockcount': {
                const stats = await prisma.networkStats.findUnique({ where: { id: 1 } });
                let count = stats?.height || 0;
                if (!count) {
                    const maxBlock = await prisma.block.aggregate({ _max: { height: true } });
                    count = maxBlock._max.height || 0;
                }
                return new NextResponse(count.toString(), { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getblockhash': {
                const index = queryParams.index || args[0];
                if (!index) return NextResponse.json({ error: 'Missing index' }, { status: 400 });
                const height = parseIntParam('index', index, { min: 0, max: LIMITS.BLOCK_HEIGHT_MAX });
                const block = await prisma.block.findUnique({
                    where: { height },
                    select: { hash: true }
                });
                if (!block?.hash) return NextResponse.json({ error: 'Block not found' }, { status: 404 });
                return new NextResponse(block.hash, { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getblock': {
                const hash = queryParams.hash || args[0];
                if (!hash) return NextResponse.json({ error: 'Missing hash' }, { status: 400 });
                if (!isValidBlockHash(hash)) return NextResponse.json({ error: 'Invalid hash' }, { status: 400 });
                const block = await getBlockJson({ hash });
                if (!block) return NextResponse.json({ error: 'Block not found' }, { status: 404 });
                return NextResponse.json(block);
            }
            case 'getrawtransaction': {
                const txid = queryParams.txid || args[0];
                const decrypt = queryParams.decrypt === '1' ? 1 : 0;
                if (!txid) return NextResponse.json({ error: 'Missing txid' }, { status: 400 });
                if (!isValidTxid(txid)) return NextResponse.json({ error: 'Invalid txid' }, { status: 400 });

                // 1. Check Mined Txs (raw bytes live in their own column since schema v4)
                const mined = await prisma.transaction.findUnique({
                    where: { txid },
                    select: { rawData: true, rawHex: decrypt === 0 }
                });

                let rawData: unknown = mined?.rawData ?? null;
                let hex: string | undefined = mined?.rawHex ? Buffer.from(mined.rawHex).toString('hex') : undefined;

                // 2. Check Mempool (same layout: JSON + raw_hex)
                if (!mined) {
                    const mempoolTx = await prisma.mempool.findUnique({
                        where: { txid },
                        select: { rawData: true, rawHex: decrypt === 0 }
                    });
                    rawData = mempoolTx?.rawData ?? null;
                    hex = mempoolTx?.rawHex ? Buffer.from(mempoolTx.rawHex).toString('hex') : undefined;
                }

                if (!rawData) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

                if (decrypt === 0) {
                    if (hex) {
                        return new NextResponse(hex, { headers: { 'Content-Type': 'text/plain' } });
                    }
                    return NextResponse.json({ error: 'Raw hex not available' }, { status: 501 });
                }

                return NextResponse.json(rawData);
            }
            case 'getnetworkhashps': {
                const stats = await prisma.networkStats.findUnique({ where: { id: 1 } });
                const hashrate = stats?.hashrate || 0;
                return new NextResponse(hashrate.toString(), { headers: { 'Content-Type': 'text/plain' } });
            }

            // --- Extended Commands (DB) ---
            case 'getmoneysupply': {
                // UTXO-set supply from the node (via network_stats), see services/supply.ts
                const { supply } = await getSupply();
                return new NextResponse(supply, { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getdistribution': {
                // Richlist-rank tiers (Iquidus contract), aggregated in SQL
                return NextResponse.json(await getDistribution());
            }
            case 'getaddress': {
                const addr = args[0] || queryParams.address;
                if (!addr) return NextResponse.json({ error: 'Missing address' }, { status: 400 });
                if (!isValidAddress(addr)) return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
                const address = await prisma.address.findUnique({ where: { address: addr } });
                if (!address) return NextResponse.json({ error: 'Address not found' }, { status: 404 });
                return NextResponse.json({
                    address: address.address,
                    sent: address.totalSent.toString(),
                    received: address.totalReceived.toString(),
                    balance: address.balance.toString(),
                    last_txs: []
                });
            }
            case 'getaddresstxs': {
                // Iquidus contract: /getaddresstxs/<address>/<start>/<length>.
                // Both numbers are validated BEFORE Prisma: `length` is capped at
                // TX_BATCH_MAX rows (each row carries the full transaction JSON)
                // and `start` may not exceed SKIP_MAX; deeper history needs cursors.
                const addr = args[0];
                if (!addr) return NextResponse.json({ error: 'Missing address' }, { status: 400 });
                if (!isValidAddress(addr)) return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
                const start = parseOffsetParam('start', args[1]);
                const length = parseSizeParam('length', args[2], 50, LIMITS.TX_BATCH_MAX);

                const txAddresses = await prisma.txAddress.findMany({
                    where: { address: addr },
                    orderBy: { time: 'desc' },
                    take: length,
                    skip: start,
                    include: { transaction: { select: { rawData: true } } }
                });

                return NextResponse.json(txAddresses.map(r => r.transaction.rawData));
            }
            case 'gettx': {
                const txid = args[0];
                if (!txid) return NextResponse.json({ error: 'Missing txid' }, { status: 400 });
                if (!isValidTxid(txid)) return NextResponse.json({ error: 'Invalid txid' }, { status: 400 });

                let tx = await prisma.transaction.findUnique({
                    where: { txid },
                    select: { rawData: true }
                });

                if (!tx) {
                    const mempoolTx = await prisma.mempool.findUnique({
                        where: { txid },
                        select: { rawData: true }
                    });
                    tx = mempoolTx;
                }

                if (tx?.rawData) return NextResponse.json(tx.rawData);
                return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
            }
            case 'getbalance': {
                const addr = args[0];
                // Iquidus clients expect "0" for anything unknown; a malformed
                // address is unknown by definition and never reaches the DB.
                if (!addr || !isValidAddress(addr)) return new NextResponse('0', { headers: { 'Content-Type': 'text/plain' } });
                const address = await prisma.address.findUnique({
                    where: { address: addr },
                    select: { balance: true }
                });
                const balance = address?.balance?.toString() ?? '0';
                return new NextResponse(balance, { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getlasttxs': {
                const min = parseDecimalParam('min', args[0], 0);
                const start = parseOffsetParam('start', args[1]);
                const length = parseSizeParam('length', args[2], 100, LIMITS.PAGINATION_MAX);

                const txs = await prisma.transaction.findMany({
                    where: { totalOutput: { gte: min } },
                    orderBy: [{ time: 'desc' }, { txid: 'asc' }],
                    take: length,
                    skip: start,
                    select: { rawData: true }
                });
                return NextResponse.json(txs.map(r => r.rawData));
            }
            case 'getcurrentprice': {
                const data = await fetchPrice();
                return NextResponse.json({ last_price_btc: data.neurai.btc, last_price_usd: data.neurai.usd });
            }
            case 'getbasicstats':
            case 'getsummary': {
                const [stats, supplyInfo, priceRes] = await Promise.all([
                    prisma.networkStats.findUnique({ where: { id: 1 } }),
                    getSupply(),
                    fetchPrice()
                ]);

                return NextResponse.json({
                    blockcount: stats?.height || 0,
                    difficulty: Number(stats?.difficulty || 0),
                    networkGraph: Number(stats?.hashrate || 0),
                    supply: supplyInfo.supply,
                    supply_source: supplyInfo.source,
                    supply_updated_at: supplyInfo.updatedAt,
                    connections: stats?.connections || 0,
                    price_btc: priceRes.neurai.btc,
                    price_usd: priceRes.neurai.usd
                });
            }
            default:
                return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 404 });
        }

    } catch (error: unknown) {
        if (error instanceof PriceUnavailableError) {
            return NextResponse.json({ error: error.message }, {
                status: 503,
                headers: { 'Cache-Control': 'no-store' },
            });
        }
        if (error instanceof InvalidParamError) {
            return NextResponse.json({ error: error.message, param: error.param }, { status: 400 });
        }
        console.error(`API Error [${command}]:`, error);
        const message = error instanceof Error && error.message ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
