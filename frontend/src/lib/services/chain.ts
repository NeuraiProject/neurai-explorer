import prisma from '@/lib/db';

/**
 * Height of the chain tip as far as the explorer knows: the node's height
 * reported by the syncer, falling back to the last indexed block.
 */
export async function getChainTip(): Promise<number> {
    const [stats, last] = await Promise.all([
        prisma.networkStats.findUnique({ where: { id: 1 }, select: { height: true } }),
        prisma.syncState.findUnique({ where: { key: 'last_height' }, select: { value: true } }),
    ]);
    const indexed = parseInt(last?.value ?? '', 10);
    return Math.max(stats?.height ?? 0, Number.isFinite(indexed) ? indexed : 0);
}

/** Confirmations of a block at `height` given the chain tip (0 if unknown). */
export function confirmationsAt(height: number | null | undefined, tip: number): number {
    if (height === null || height === undefined || tip < height) return 0;
    return tip - height + 1;
}
