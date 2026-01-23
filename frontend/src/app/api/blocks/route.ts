import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { rateLimit, getClientIp, getRateLimitHeaders } from '@/lib/rateLimit';
import { validatePaginationParams } from '@/lib/validation';
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

    try {
        const blocks = await prisma.block.findMany({
            orderBy: { height: 'desc' },
            take: limit,
            skip: skip,
        });

        const result = blocks.map(row => ({
            ...(row.rawData as object),
            height: row.height,
            time: row.time,
            txCount: row.txCount,
        }));

        return NextResponse.json(result, {
            headers: getRateLimitHeaders(ip, maxRequests),
        });
    } catch (error) {
        console.error('Latest Blocks API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
