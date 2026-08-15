import { NextResponse } from 'next/server';
import { getAssetData } from '@/lib/services/asset';

/**
 * GET /api/asset/[name]
 * Asset metadata, holder count, top holders, issuance/reissuance history and
 * the latest movements. Amounts are decimal strings.
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name } = await params;
        const data = await getAssetData(decodeURIComponent(name));
        if (!data) {
            return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
        }
        return NextResponse.json(data);
    } catch (error) {
        console.error('Asset API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
