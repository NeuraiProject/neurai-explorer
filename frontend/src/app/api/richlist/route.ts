import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { rateLimit, getClientIp, getRateLimitHeaders } from '@/lib/rateLimit';
import { parseNumericParam, LIMITS } from '@/lib/validation';
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
    const limit = parseNumericParam(
        searchParams.get('limit'),
        config.ui.richListLimit,
        1,
        LIMITS.RICHLIST_MAX
    );

    try {
        const addresses = await prisma.address.findMany({
            orderBy: { balance: 'desc' },
            take: limit,
        });

        const result = addresses.map(a => ({
            address: a.address,
            balance: a.balance.toString(),
            total_received: a.totalReceived.toString(),
            total_sent: a.totalSent.toString(),
            tx_count: a.txCount,
        }));

        return NextResponse.json(result, {
            headers: getRateLimitHeaders(ip, maxRequests),
        });
    } catch (error) {
        console.error('Richlist API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
