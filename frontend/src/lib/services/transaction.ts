import prisma from '@/lib/db';
import { confirmationsAt, getChainTip } from '@/lib/services/chain';

/**
 * Confirmed transaction JSON as the API exposes it: the decoded transaction
 * (amounts as decimal strings) plus height, block hash/time, confirmations,
 * and the exact `totalOutput` and `fee` computed by the syncer.
 */
export async function getTransactionJson(txid: string): Promise<Record<string, unknown> | null> {
    const tx = await prisma.transaction.findUnique({
        where: { txid },
        // rawHex is served by the getrawtransaction command, not here
        select: {
            rawData: true,
            time: true,
            blockHeight: true,
            totalOutput: true,
            fee: true,
            block: { select: { hash: true } },
        },
    });
    if (!tx?.rawData) return null;

    const tip = await getChainTip();
    const raw = tx.rawData as Record<string, unknown>;

    return {
        ...raw,
        blocktime: tx.time,
        height: tx.blockHeight,
        blockhash: tx.block?.hash ?? raw.blockhash,
        confirmations: confirmationsAt(tx.blockHeight, tip),
        totalOutput: tx.totalOutput?.toString(),
        fee: tx.fee?.toString(),
    };
}
