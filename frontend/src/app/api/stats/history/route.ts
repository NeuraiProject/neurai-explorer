import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic'; // Ensure this endpoint is not cached statically

export async function GET() {
    try {
        // Fetch last 1440 blocks (approx 24 hours)
        const blocks = await prisma.block.findMany({
            orderBy: { height: 'desc' },
            take: 1440,
            select: { time: true, height: true, difficulty: true },
        });

        // Format for graph: sort by height ASC
        const data = blocks
            .map(row => ({
                time: row.time,
                height: row.height,
                difficulty: Number(row.difficulty ?? 0),
            }))
            .sort((a, b) => a.height - b.height);

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching history:', error);
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}
