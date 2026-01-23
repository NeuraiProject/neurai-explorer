import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
    try {
        const stats = await prisma.networkStats.findFirst({
            select: { peersData: true },
        });

        return NextResponse.json(stats?.peersData ?? []);
    } catch (error) {
        console.error('Peers API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
