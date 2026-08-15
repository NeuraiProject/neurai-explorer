import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getBlockJson } from '@/lib/services/block';
import { getDistribution, getSupply } from '@/lib/services/supply';

// We removed rpcCall import. Everything must come from DB or external APIs (e.g. coingecko)

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
                const block = await prisma.block.findUnique({
                    where: { height: parseInt(index) },
                    select: { hash: true }
                });
                if (!block?.hash) return NextResponse.json({ error: 'Block not found' }, { status: 404 });
                return new NextResponse(block.hash, { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getblock': {
                const hash = queryParams.hash || args[0];
                if (!hash) return NextResponse.json({ error: 'Missing hash' }, { status: 400 });
                const block = await getBlockJson({ hash });
                if (!block) return NextResponse.json({ error: 'Block not found' }, { status: 404 });
                return NextResponse.json(block);
            }
            case 'getrawtransaction': {
                const txid = queryParams.txid || args[0];
                const decrypt = queryParams.decrypt === '1' ? 1 : 0;
                if (!txid) return NextResponse.json({ error: 'Missing txid' }, { status: 400 });

                // 1. Check Mined Txs (raw bytes live in their own column since schema v4)
                const mined = await prisma.transaction.findUnique({
                    where: { txid },
                    select: { rawData: true, rawHex: decrypt === 0 }
                });

                let rawData: unknown = mined?.rawData ?? null;
                let hex: string | undefined = mined?.rawHex ? Buffer.from(mined.rawHex).toString('hex') : undefined;

                // 2. Check Mempool (its JSON still carries `hex`)
                if (!mined) {
                    const mempoolTx = await prisma.mempool.findUnique({
                        where: { txid },
                        select: { rawData: true }
                    });
                    rawData = mempoolTx?.rawData ?? null;
                    hex = (mempoolTx?.rawData as { hex?: string } | null)?.hex;
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
                const addr = args[0];
                const start = parseInt(args[1] || '0');
                const length = parseInt(args[2] || '50');
                if (!addr) return NextResponse.json({ error: 'Missing address' }, { status: 400 });

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
                if (!addr) return new NextResponse('0', { headers: { 'Content-Type': 'text/plain' } });
                const address = await prisma.address.findUnique({
                    where: { address: addr },
                    select: { balance: true }
                });
                const balance = address?.balance?.toString() ?? '0';
                return new NextResponse(balance, { headers: { 'Content-Type': 'text/plain' } });
            }
            case 'getlasttxs': {
                const min = parseFloat(args[0] || '0');
                const start = parseInt(args[1] || '0');
                const length = Math.min(parseInt(args[2] || '100'), 100);

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
                const gecko = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=neurai&vs_currencies=usd,btc');
                const data = await gecko.json();
                return NextResponse.json({ last_price_btc: data.neurai?.btc || 0, last_price_usd: data.neurai?.usd || 0 });
            }
            case 'getbasicstats':
            case 'getsummary': {
                const [stats, supplyInfo, priceRes] = await Promise.all([
                    prisma.networkStats.findUnique({ where: { id: 1 } }),
                    getSupply(),
                    fetch('https://api.coingecko.com/api/v3/simple/price?ids=neurai&vs_currencies=usd,btc').then(r => r.json()).catch(() => ({}))
                ]);

                return NextResponse.json({
                    blockcount: stats?.height || 0,
                    difficulty: Number(stats?.difficulty || 0),
                    networkGraph: Number(stats?.hashrate || 0),
                    supply: supplyInfo.supply,
                    supply_source: supplyInfo.source,
                    supply_updated_at: supplyInfo.updatedAt,
                    connections: stats?.connections || 0,
                    price_btc: priceRes.neurai?.btc || 0,
                    price_usd: priceRes.neurai?.usd || 0
                });
            }
            default:
                return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 404 });
        }

    } catch (error: any) {
        console.error(`API Error [${command}]:`, error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
