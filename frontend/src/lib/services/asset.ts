import prisma from '@/lib/db';
import type { Asset } from '@/types';

export interface AssetHolder {
    address: string;
    /** Decimal string */
    balance: string;
}

export interface AssetEventView {
    txid: string;
    voutN: number;
    blockHeight: number;
    /** Block time (unix seconds), when the block is indexed */
    time: number | null;
    /** `new_asset` | `reissue_asset` */
    type: string;
    /** Units issued in this event (decimal string) */
    amount: string;
    units: number;
    reissuable: boolean;
    hasIpfs: boolean;
    ipfsHash: string | null;
}

export interface AssetMoveView {
    txid: string;
    address: string;
    /** + received / - sent, decimal string */
    delta: string;
    blockHeight: number | null;
    time: number | null;
}

export interface AssetData {
    asset: Asset;
    /** Number of addresses holding a positive balance */
    holderCount: number;
    /** Top holders (by balance), at most `holdersLimit` */
    holders: AssetHolder[];
    /** Issuance / reissuance events, oldest first */
    events: AssetEventView[];
    /** Latest per-address movements, newest first */
    recent: AssetMoveView[];
}

/**
 * Everything the asset page shows: metadata (`assets`), holders
 * (`address_assets`), issuance history (`asset_events`) and the latest
 * movements (`tx_address_assets`).
 */
export async function getAssetData(
    name: string,
    { holdersLimit = 100, recentLimit = 50 }: { holdersLimit?: number; recentLimit?: number } = {}
): Promise<AssetData | null> {
    const asset = await prisma.asset.findUnique({ where: { name } });
    if (!asset) return null;

    const [holderCount, holders, events, moves] = await Promise.all([
        prisma.addressAsset.count({ where: { assetName: name, balance: { gt: 0 } } }),
        prisma.addressAsset.findMany({
            where: { assetName: name, balance: { gt: 0 } },
            orderBy: [{ balance: 'desc' }, { address: 'asc' }],
            take: holdersLimit,
            select: { address: true, balance: true },
        }),
        prisma.assetEvent.findMany({
            where: { assetName: name },
            orderBy: [{ blockHeight: 'asc' }, { txIndex: 'asc' }, { voutN: 'asc' }],
            select: {
                txid: true, voutN: true, blockHeight: true, type: true, amount: true,
                units: true, reissuable: true, hasIpfs: true, ipfsHash: true,
                transaction: { select: { time: true } },
            },
        }),
        prisma.txAddressAsset.findMany({
            where: { assetName: name },
            // idx_txaa_asset_height (asset_name, block_height DESC, txid)
            orderBy: [{ blockHeight: 'desc' }, { txid: 'asc' }],
            take: recentLimit,
            select: {
                txid: true, address: true, delta: true, blockHeight: true,
                transaction: { select: { time: true } },
            },
        }),
    ]);

    return {
        asset: {
            name: asset.name,
            amount: asset.amount?.toString() ?? '0',
            units: asset.units ?? 0,
            reissuable: asset.reissuable ?? false,
            hasIpfs: asset.hasIpfs ?? false,
            ipfsHash: asset.ipfsHash ?? undefined,
            txid: asset.txid ?? '',
            blockHeight: asset.blockHeight ?? 0,
            type: asset.type ?? 'asset',
        },
        holderCount,
        holders: holders.map(h => ({ address: h.address, balance: h.balance.toString() })),
        events: events.map(e => ({
            txid: e.txid,
            voutN: e.voutN,
            blockHeight: e.blockHeight,
            time: e.transaction?.time ?? null,
            type: e.type,
            amount: e.amount.toString(),
            units: e.units,
            reissuable: e.reissuable,
            hasIpfs: e.hasIpfs,
            ipfsHash: e.ipfsHash,
        })),
        recent: moves.map(m => ({
            txid: m.txid,
            address: m.address,
            delta: m.delta.toString(),
            blockHeight: m.blockHeight,
            time: m.transaction?.time ?? null,
        })),
    };
}
