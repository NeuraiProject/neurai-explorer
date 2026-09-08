import { NextResponse } from 'next/server';
import { getAddressData } from '@/lib/services/address';
import { InvalidParamError, isValidAddress, parsePageParams } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
    try {
        const { address } = await params;
        if (!isValidAddress(address)) {
            return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
        }
        const { searchParams } = new URL(request.url);
        // Rejects non-integers and bounds the computed offset, not just `page`
        const { page, pageSize } = parsePageParams(searchParams, { pageSize: 50 });

        const data = await getAddressData(address, page, pageSize);
        if (!data) {
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        if (error instanceof InvalidParamError) {
            return NextResponse.json({ error: error.message, param: error.param }, { status: 400 });
        }
        console.error('Address API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
