import prisma from '@/lib/db';
import { confirmationsAt, getChainTip } from '@/lib/services/chain';

/**
 * Full block JSON as the API exposes it: the stored header (`blocks.raw_data`)
 * plus the transactions of the block, in block order, and the chain-dependent
 * fields (`confirmations`, `nextblockhash`) computed from the current state
 * rather than frozen at sync time.
 *
 * Since schema v4 the stored block lists only txids under `tx`; the decoded
 * transactions live in `transactions.raw_data`.
 */
export async function getBlockJson(where: { hash: string } | { height: number }): Promise<Record<string, unknown> | null> {
    if ('height' in where && !Number.isInteger(where.height)) return null;

    const block = await prisma.block.findUnique({
        where,
        select: { height: true, rawData: true },
    });
    if (!block?.rawData) return null;

    const [txs, next, tip] = await Promise.all([
        prisma.transaction.findMany({
            where: { blockHeight: block.height },
            orderBy: { txIndex: 'asc' },
            select: { rawData: true, totalOutput: true, fee: true },
        }),
        prisma.block.findUnique({
            where: { height: block.height + 1 },
            select: { hash: true },
        }),
        getChainTip(),
    ]);

    const raw = block.rawData as Record<string, unknown>;
    return {
        ...raw,
        // Each tx carries its exact totals so the UI never sums outputs in floats
        tx: txs.map(t => ({
            ...(t.rawData as Record<string, unknown>),
            totalOutput: t.totalOutput?.toString(),
            fee: t.fee?.toString(),
        })),
        confirmations: confirmationsAt(block.height, tip),
        ...(next?.hash ? { nextblockhash: next.hash } : {}),
    };
}

/** Where-clause for a block id that is either a height or a 64-char hash. */
export function blockWhere(id: string): { hash: string } | { height: number } {
    return id.length === 64 ? { hash: id } : { height: parseInt(id, 10) };
}
