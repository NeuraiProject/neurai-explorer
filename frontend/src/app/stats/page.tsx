import prisma from "@/lib/db";
import StatsView from "./StatsView";

export const dynamic = 'force-dynamic';

export default async function StatsPage() {
    let stats: any[] = [];
    try {
        stats = await prisma.dailyStats.findMany({
            orderBy: { date: 'desc' },
            take: 365
        });
    } catch (e) {
        console.error("Failed to fetch stats:", e);
    }

    // Pass data to Client Component
    // Serialize dates and convert Decimal/BigInt to numbers
    const cleanStats = stats.map(s => ({
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

    return (
        <div className="container mx-auto px-4 py-8">
            <StatsView data={cleanStats} />
        </div>
    );
}
