import { unstable_cache } from 'next/cache';
import prisma from '@/lib/db';

async function loadDailyStats() {
    // Let failures reject so revalidation retains the last successful result.
    const stats = await prisma.dailyStats.findMany({
        orderBy: { date: 'desc' },
        take: 365,
    });

    // Cache the serialized chart data, including Decimal/BigInt conversions.
    return stats.map(s => ({
        date: s.date.toISOString(),
        tx_count: s.txCount,
        total_output: Number(s.totalOutput),
        sum_difficulty: Number(s.sumDifficulty),
        block_count: s.blockCount,
        new_assets_count: s.newAssetsCount,
        active_address_count: s.activeAddressCount,
        burned_coins: Number(s.burnedCoins),
        sum_block_size: Number(s.sumBlockSize),
        new_supply: Number(s.newSupply)
    }));
}

// Coalesce concurrent cold loads/refreshes within each worker.
let pending: ReturnType<typeof loadDailyStats> | undefined;

export const getDailyStats = unstable_cache(() => {
    if (!pending) {
        pending = loadDailyStats().finally(() => { pending = undefined; });
    }
    return pending;
}, ['daily-stats-v1'], { revalidate: 60 });
