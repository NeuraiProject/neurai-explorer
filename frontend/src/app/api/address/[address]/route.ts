import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
    try {
        const { address } = await params;
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '50');
        const offset = (page - 1) * pageSize;

        // 1. Get Address Summary
        const addrData = await prisma.address.findUnique({
            where: { address },
        });

        if (!addrData) {
            // Return empty structure for new/unused addresses
            return NextResponse.json({
                address,
                balance: "0",
                totalReceived: "0",
                totalSent: "0",
                txs: 0,
                transactions: [],
                totalPages: 0,
                page,
            });
        }

        // 2. Get Transactions (History) with JOIN
        const txAddresses = await prisma.txAddress.findMany({
            where: { address },
            orderBy: { time: 'desc' },
            take: pageSize,
            skip: offset,
            include: {
                transaction: true,
            },
        });

        // Enrich txs with stored time/height
        const transactions = txAddresses.map(ta => ({
            ...(ta.transaction.rawData as object),
            blocktime: ta.transaction.time,
            height: ta.transaction.blockHeight,
        }));

        return NextResponse.json({
            address: addrData.address,
            balance: addrData.balance.toString(),
            totalReceived: addrData.totalReceived.toString(),
            totalSent: addrData.totalSent.toString(),
            txs: addrData.txCount,
            transactions: transactions,
            totalPages: Math.ceil(addrData.txCount / pageSize),
            page: page,
        });
    } catch (error) {
        console.error('Address API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
