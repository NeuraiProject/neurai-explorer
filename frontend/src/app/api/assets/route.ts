import { NextResponse } from 'next/server';
import prisma from "@/lib/db";
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
        const assets = await prisma.$queryRaw`
            SELECT a.name, a.type, a.amount, a.units, a.reissuable,
                   a.has_ipfs, a.ipfs_hash as "ipfsHash", a.txid, a.block_height as "blockHeight", b.time
            FROM assets a
            LEFT JOIN blocks b ON a.block_height = b.height
            ORDER BY a.block_height DESC
            LIMIT ${limit} OFFSET ${skip}
        `;

        // Cast BigInt to Number/String for JSON serialization
        const serializedAssets = (assets as Record<string, unknown>[]).map(a => ({
            ...a,
            amount: Number(a.amount),
            units: a.units ?? 0,
            reissuable: a.reissuable ?? false,
            has_ipfs: a.has_ipfs ?? false,
            time: a.time ?? 0
        }));

        return NextResponse.json(serializedAssets, {
            headers: getRateLimitHeaders(ip, maxRequests),
        });
    } catch (error) {
        console.error("Failed to fetch assets via API:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
