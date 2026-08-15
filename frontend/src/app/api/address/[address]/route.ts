import { NextResponse } from 'next/server';
import { getAddressData } from '@/lib/services/address';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
    try {
        const { address } = await params;
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50') || 50));

        const data = await getAddressData(address, page, pageSize);
        if (!data) {
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Address API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
