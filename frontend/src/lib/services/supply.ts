import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface SupplyInfo {
    /** Decimal string */
    supply: string;
    /**
     * `utxo_set`: `gettxoutsetinfo.total_amount` reported by the node and
     * refreshed by the syncer every `supplyInterval` (10 min by default); it
     * can trail the tip by that much and differs from the sum of indexed
     * balances by outputs without an address (OP_RETURN, non-standard).
     * `indexed_balances`: fallback used only while the node value is not
     * available yet (first minutes of a fresh install).
     */
    source: 'utxo_set' | 'indexed_balances';
    /** Unix seconds of the last node refresh (null for the fallback) */
    updatedAt: number | null;
}

/**
 * Circulating supply as the explorer knows it: the node's UTXO-set total when
 * the syncer has stored it, otherwise the sum of indexed balances.
 */
export async function getSupply(): Promise<SupplyInfo> {
    const stats = await prisma.networkStats.findUnique({
        where: { id: 1 },
        select: { supply: true, updatedAt: true },
    });
    if (stats?.supply) {
        return { supply: stats.supply.toString(), source: 'utxo_set', updatedAt: stats.updatedAt ?? null };
    }
    const sum = await prisma.address.aggregate({ _sum: { balance: true } });
    return { supply: sum._sum.balance?.toString() ?? '0', source: 'indexed_balances', updatedAt: null };
}

interface TierRow {
    tier: string;
    total: Prisma.Decimal | string;
    count: bigint | number;
}

export interface DistributionTier {
    /** Share of `supply`, in percent (number, 2 decimals) */
    percent: number;
    /** Decimal string */
    total: string;
    count: number;
}

export interface Distribution {
    supply: string;
    supplySource: SupplyInfo['source'];
    t_1_25: DistributionTier;
    t_26_50: DistributionTier;
    t_51_75: DistributionTier;
    t_76_100: DistributionTier;
    t_101_plus: DistributionTier;
}

const TIERS = ['t_1_25', 't_26_50', 't_51_75', 't_76_100', 't_101_plus'] as const;

/**
 * Wealth distribution by richlist rank (the Iquidus `getdistribution`
 * contract): addresses ranked 1-25, 26-50, 51-75, 76-100 and the rest, each
 * with the sum of their balances and its share of the supply.
 *
 * `total`/`count` come from `addresses` in one aggregate query (no rows are
 * loaded into Node); `percent` uses the UTXO-set supply, so the five tiers
 * may not add up to exactly 100 %.
 */
export async function getDistribution(): Promise<Distribution> {
    const [supply, rows] = await Promise.all([
        getSupply(),
        prisma.$queryRaw<TierRow[]>`
            WITH ranked AS (
                SELECT balance, ROW_NUMBER() OVER (ORDER BY balance DESC, address) AS rk
                FROM addresses
                WHERE balance > 0
            )
            SELECT CASE WHEN rk <= 25 THEN 't_1_25'
                        WHEN rk <= 50 THEN 't_26_50'
                        WHEN rk <= 75 THEN 't_51_75'
                        WHEN rk <= 100 THEN 't_76_100'
                        ELSE 't_101_plus' END AS tier,
                   SUM(balance) AS total,
                   COUNT(*) AS count
            FROM ranked
            GROUP BY 1
        `,
    ]);

    const supplyNum = Number(supply.supply); // percent only: a double is fine here
    const empty = (): DistributionTier => ({ percent: 0, total: '0', count: 0 });
    const result: Distribution = {
        supply: supply.supply,
        supplySource: supply.source,
        t_1_25: empty(), t_26_50: empty(), t_51_75: empty(), t_76_100: empty(), t_101_plus: empty(),
    };
    for (const row of rows) {
        const tier = TIERS.find(t => t === row.tier);
        if (!tier) continue;
        const total = row.total.toString();
        result[tier] = {
            total,
            count: Number(row.count),
            percent: supplyNum > 0 ? Math.round((Number(total) / supplyNum) * 10000) / 100 : 0,
        };
    }
    return result;
}
