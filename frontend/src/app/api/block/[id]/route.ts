import { NextResponse } from 'next/server';
import { blockWhere, getBlockJson } from '@/lib/services/block';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // Neurai block hashes are 64 chars; anything else must be a plain height
        const where = blockWhere(id);
        if (!where) {
            return NextResponse.json({ error: 'Invalid block id: expected a 64-hex hash or a height' }, { status: 400 });
        }
        const block = await getBlockJson(where);

        if (!block) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 });
        }

        return NextResponse.json(block);
    } catch (error) {
        console.error('Block API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
