import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        let block;

        // Check if ID is height (number) or hash (string length)
        // Neurai block hashes are 64 chars
        if (id.length === 64) {
            block = await prisma.block.findUnique({
                where: { hash: id },
                select: { rawData: true },
            });
        } else {
            block = await prisma.block.findUnique({
                where: { height: parseInt(id, 10) },
                select: { rawData: true },
            });
        }

        if (!block) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 });
        }

        return NextResponse.json(block.rawData);
    } catch (error) {
        console.error('Block API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
