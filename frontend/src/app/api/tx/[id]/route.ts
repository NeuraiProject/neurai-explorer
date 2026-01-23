import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        const tx = await prisma.transaction.findUnique({
            where: { txid: id },
        });

        if (!tx) {
            return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        const data = {
            ...(tx.rawData as object),
            blocktime: tx.time,
            height: tx.blockHeight,
        };

        return NextResponse.json(data);
    } catch (error) {
        console.error('Tx API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
