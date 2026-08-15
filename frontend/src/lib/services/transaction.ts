import prisma from '@/lib/db';
import { confirmationsAt, getChainTip } from '@/lib/services/chain';

interface RawVin { coinbase?: string; value?: number | string }
interface RawVout { value?: number | string }

/**
 * Fee of a decoded transaction: inputs minus outputs. Inputs carry `value`
 * once the syncer has enriched them; if any non-coinbase input lacks it the
 * fee is unknown (`undefined`). Coinbase transactions have no fee (0).
 */
export function computeFee(raw: { vin?: RawVin[]; vout?: RawVout[] }): number | undefined {
    const vin = raw.vin ?? [];
    const vout = raw.vout ?? [];
    if (vin.some(v => v.coinbase !== undefined)) return 0;
    let inputs = 0;
    for (const v of vin) {
        if (v.value === undefined || v.value === null) return undefined;
        inputs += Number(v.value);
    }
    const outputs = vout.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
    // Amounts have 8 decimals; keep the result on that grid.
    return Math.round((inputs - outputs) * 1e8) / 1e8;
}

/**
 * Confirmed transaction JSON as the API exposes it: the decoded transaction
 * plus height, block hash/time, confirmations and fee.
 */
export async function getTransactionJson(txid: string): Promise<Record<string, unknown> | null> {
    const tx = await prisma.transaction.findUnique({
        where: { txid },
        // rawHex is served by the getrawtransaction command, not here
        select: {
            rawData: true,
            time: true,
            blockHeight: true,
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
        fee: computeFee(raw as { vin?: RawVin[]; vout?: RawVout[] }),
    };
}
