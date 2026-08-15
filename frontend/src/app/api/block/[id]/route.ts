import { NextResponse } from 'next/server';
import { blockWhere, getBlockJson } from '@/lib/services/block';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // Neurai block hashes are 64 chars; anything else is a height
        const block = await getBlockJson(blockWhere(id));

        if (!block) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 });
        }

        return NextResponse.json(block);
    } catch (error) {
        console.error('Block API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
