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

/**
 * Address summary plus one page of its history, newest first.
 *
 * Each transaction carries what the address received/spent in it (`received`,
 * `sent`, from `tx_addresses`) and the asset units it moved (`assetDeltas`,
 * from `tx_address_assets`), so callers do not need to walk vin/vout.
 */
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

        // 2. Get Transactions (History): tx_count counts exactly these rows
        const offset = (page - 1) * pageSize;
        const txAddresses = await prisma.txAddress.findMany({
            where: { address },
            orderBy: [{ time: 'desc' }, { txid: 'asc' }],
            take: pageSize,
            skip: offset,
            select: {
                txid: true,
                received: true,
                sent: true,
                transaction: {
                    select: { rawData: true, time: true, blockHeight: true }
                }
            }
        });

        // 3. Asset moves of those transactions for this address
        const assetMoves = txAddresses.length > 0
            ? await prisma.txAddressAsset.findMany({
                where: { address, txid: { in: txAddresses.map(r => r.txid) } },
                select: { txid: true, assetName: true, delta: true },
                orderBy: { assetName: 'asc' },
            })
            : [];
        const assetsByTx = new Map<string, { asset: string; delta: string }[]>();
        for (const m of assetMoves) {
            const list = assetsByTx.get(m.txid) ?? [];
            list.push({ asset: m.assetName, delta: m.delta.toString() });
            assetsByTx.set(m.txid, list);
        }

        // Enrich txs with our stored time/height and the per-address deltas
        const transactions: Transaction[] = txAddresses.map(row => ({
            ...(row.transaction.rawData as unknown as Transaction),
            blocktime: row.transaction.time ?? 0,
            height: row.transaction.blockHeight ?? 0,
            received: row.received.toString(),
            sent: row.sent.toString(),
            assetDeltas: assetsByTx.get(row.txid) ?? [],
        }));

        return {
            address: addrData.address,
            balance: addrData.balance.toString(),
            totalReceived: addrData.totalReceived.toString(),
            totalSent: addrData.totalSent.toString(),
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
