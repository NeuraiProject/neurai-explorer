import prisma from '@/lib/db';

import { Transaction } from "@/types";

export interface AddressData {
    address: string;
    balance: string;
    totalReceived: string;
    totalSent: string;
    txs: number;
    transactions: Transaction[];
    totalPages: number;
    page: number;
}

export async function getAddressData(address: string, page: number = 1, pageSize: number = 50): Promise<AddressData | null> {
    try {
        // 1. Get Address Summary
        const addrData = await prisma.address.findUnique({
            where: { address }
        });

        if (!addrData) {
            // Return empty structure for new/unused addresses
            return {
                address,
                balance: "0",
                totalReceived: "0",
                totalSent: "0",
                txs: 0,
                transactions: [],
                totalPages: 0,
                page,
            };
        }

        // 2. Get Transactions (History)
        const offset = (page - 1) * pageSize;
        const txAddresses = await prisma.txAddress.findMany({
            where: { address },
            orderBy: { time: 'desc' },
            take: pageSize,
            skip: offset,
            include: {
                transaction: {
                    select: { rawData: true, time: true, blockHeight: true }
                }
            }
        });

        // Enrich txs with our stored time/height
        const transactions: Transaction[] = txAddresses.map((row: any) => ({
            ...(row.transaction.rawData as any),
            blocktime: row.transaction.time ?? 0,
            height: row.transaction.blockHeight ?? 0
        }));

        return {
            address: addrData.address,
            balance: Number(addrData.balance).toString(),
            totalReceived: Number(addrData.totalReceived).toString(),
            totalSent: Number(addrData.totalSent).toString(),
            txs: addrData.txCount,
            transactions: transactions,
            totalPages: Math.ceil(addrData.txCount / pageSize),
            page: page,
        };

    } catch (e) {
        console.error("Error fetching address data from DB:", e);
        return null;
    }
}
