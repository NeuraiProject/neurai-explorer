import { NextResponse } from 'next/server';
import { getTransactionJson } from '@/lib/services/transaction';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        const data = await getTransactionJson(id);

        if (!data) {
            return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Tx API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
