import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { rateLimit, getClientIp, getRateLimitHeaders } from '@/lib/rateLimit';
import { validatePaginationParams, parseNumericParam } from '@/lib/validation';
import config from '@/config.json';

export const dynamic = 'force-dynamic';

const { windowMs, maxRequests } = config.security.rateLimit;

export async function GET(request: Request) {
    const ip = getClientIp(request);

    if (!rateLimit(ip, maxRequests, windowMs)) {
        return NextResponse.json(
            { error: 'Rate limit exceeded' },
            { status: 429, headers: getRateLimitHeaders(ip, maxRequests) }
        );
    }

    const { searchParams } = new URL(request.url);
    const { limit, skip } = validatePaginationParams(searchParams);
    const minTotalOutputRaw = searchParams.get('minTotalOutput');
    const minTotalOutput = minTotalOutputRaw ? parseFloat(minTotalOutputRaw) : NaN;

    try {
        const transactions = await prisma.transaction.findMany({
            where: Number.isFinite(minTotalOutput)
                ? { totalOutput: { gte: minTotalOutput } }
                : undefined,
            orderBy: { time: 'desc' },
            take: limit,
            skip: skip,
        });

        const result = transactions.map(row => ({
            ...(row.rawData as object),
            height: row.blockHeight,
            blocktime: row.time,
            txid: row.txid,
            totalOutput: Number(row.totalOutput ?? 0),
        }));

        return NextResponse.json(result, {
            headers: getRateLimitHeaders(ip, maxRequests),
        });
    } catch (error) {
        console.error('Latest Txs API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
