import { Card } from "@/components/ui/Card";
import { TxIdDisplay } from "@/components/TxIdDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetData, type AssetData } from "@/lib/services/asset";
import { formatDate, satsOf } from "@/lib/utils";
import { Amount } from "@/components/ui/Amount";

export const dynamic = 'force-dynamic';

const ZERO = BigInt(0);

export default async function AssetPage({ params }: { params: Promise<{ name: string }> }) {
    const { name } = await params;
    const assetName = decodeURIComponent(name);

    let data: AssetData | null = null;
    try {
        data = await getAssetData(assetName);
    } catch (e) {
        console.error("Error fetching asset:", e);
    }

    const assetData = data?.asset ?? null;
    const holders = data?.holders ?? [];
    const holderCount = data?.holderCount ?? 0;
    const events = data?.events ?? [];
    const recent = data?.recent ?? [];

    if (!assetData) {
        return notFound();
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-6xl">
            <Link href="/assets" className="text-muted-foreground hover:text-primary mb-6 inline-flex items-center gap-2 transition-colors">
                <span>&larr;</span> Back to Assets
            </Link>

            <div className="grid gap-8 md:grid-cols-2 mb-8">
                <Card title="Asset Details" className="h-full">
                    <div className="p-6 space-y-6">
                        <div className="flex justify-between items-center border-b border-border pb-4 last:border-0 last:pb-0">
                            <span className="font-medium text-muted-foreground">Name</span>
                            <span className="font-bold text-lg">{assetData.name}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-4 last:border-0 last:pb-0">
                            <span className="font-medium text-muted-foreground">Amount</span>
                            <Amount value={assetData.amount} decimals={assetData.units} grouping className="text-lg" />
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-4 last:border-0 last:pb-0">
                            <span className="font-medium text-muted-foreground">Units</span>
                            <span>{assetData.units}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-4 last:border-0 last:pb-0">
                            <span className="font-medium text-muted-foreground">Reissuable</span>
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${assetData.reissuable ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                {assetData.reissuable ? "YES" : "NO"}
                            </span>
                        </div>
                        {assetData.ipfsHash && (
                            <div className="flex justify-between items-center border-b border-border pb-4 last:border-0 last:pb-0">
                                <span className="font-medium text-muted-foreground">IPFS Hash</span>
                                <span className="text-sm font-mono bg-muted p-1 rounded max-w-[200px] md:max-w-[150px] lg:max-w-[250px] truncate" title={assetData.ipfsHash}>
                                    {assetData.ipfsHash}
                                </span>
                            </div>
                        )}
                        <div className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                            <span className="font-medium text-muted-foreground">Transaction ID</span>
                            <Link href={`/tx/${assetData.txid}`} className="block min-w-0 overflow-hidden text-primary hover:underline text-sm font-mono">
                                <TxIdDisplay txid={assetData.txid} className="text-sm" />
                            </Link>
                        </div>
                    </div>
                </Card>

                {assetData.hasIpfs && assetData.ipfsHash && (
                    <Card title="Preview" className="h-full">
                        <div className="p-6 flex items-center justify-center min-h-[300px] bg-muted/10">
                            <img
                                src={`https://ipfs.neurai.org/ipfs/${assetData.ipfsHash}`}
                                alt={assetData.name}
                                className="max-w-full max-h-[400px] w-auto h-auto rounded-lg shadow-lg border border-border"
                            />
                        </div>
                    </Card>
                )}
            </div>

            <div className="grid gap-8 lg:grid-cols-2 mb-8">
                <Card title={`Issuance history (${events.length})`}>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/50 sticky top-0">
                                <tr className="border-b border-border">
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Block</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Event</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Amount</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Tx</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map(ev => (
                                    <tr key={`${ev.txid}:${ev.voutN}`} className="border-b border-border hover:bg-muted/50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <Link href={`/block/${ev.blockHeight}`} className="text-primary hover:underline font-mono">#{ev.blockHeight}</Link>
                                            {ev.time ? <div className="text-xs text-muted-foreground">{formatDate(ev.time)}</div> : null}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${ev.type === 'new_asset' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                                                {ev.type === 'new_asset' ? 'Issued' : 'Reissued'}
                                            </span>
                                            {ev.ipfsHash ? <div className="text-xs font-mono text-muted-foreground truncate max-w-[180px]" title={ev.ipfsHash}>{ev.ipfsHash}</div> : null}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                                            <Amount value={ev.amount} decimals={assetData.units} grouping />
                                        </td>
                                        <td className="px-4 py-3 font-mono">
                                            <Link href={`/tx/${ev.txid}`} className="text-primary hover:underline">
                                                <TxIdDisplay txid={ev.txid} className="text-xs" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                                {events.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No issuance events indexed.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>

                <Card title="Recent movements">
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/50 sticky top-0">
                                <tr className="border-b border-border">
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Block</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Address</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Amount</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Tx</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recent.map(mv => {
                                    const sats = satsOf(mv.delta);
                                    const cls = sats > ZERO ? 'text-green-600 dark:text-green-400' : sats < ZERO ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
                                    const sign = sats > ZERO ? '+' : sats < ZERO ? '-' : '';
                                    const abs = sats < ZERO ? -sats : sats;
                                    return (
                                        <tr key={`${mv.txid}:${mv.address}`} className="border-b border-border hover:bg-muted/50 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {mv.blockHeight !== null ? <Link href={`/block/${mv.blockHeight}`} className="text-primary hover:underline font-mono">#{mv.blockHeight}</Link> : '—'}
                                                {mv.time ? <div className="text-xs text-muted-foreground">{formatDate(mv.time)}</div> : null}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                <Link href={`/address/${mv.address}`} className="text-primary hover:underline block truncate max-w-[220px]" title={mv.address}>{mv.address}</Link>
                                            </td>
                                            <td className={`px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${cls}`}>
                                                <Amount sats={abs} sign={sign} decimals={assetData.units} grouping />
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                <Link href={`/tx/${mv.txid}`} className="text-primary hover:underline">
                                                    <TxIdDisplay txid={mv.txid} className="text-xs" />
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {recent.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No movements indexed.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

            <Card title={`Holders (${holderCount})${holderCount > holders.length ? ` · top ${holders.length}` : ''}`}>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr className="border-b border-border">
                                <th className="px-6 py-3 font-medium text-muted-foreground text-center w-12 text-sm lg:text-base">#</th>
                                <th className="px-6 py-3 font-medium text-muted-foreground text-sm lg:text-base">Address</th>
                                <th className="px-6 py-3 font-medium text-muted-foreground text-right text-sm lg:text-base">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {holders.map((holder, idx) => (
                                <tr key={holder.address} className="border-b border-border hover:bg-muted/50 transition-colors">
                                    <td className="px-6 py-4 text-center text-muted-foreground text-sm">{idx + 1}</td>
                                    <td className="px-6 py-4 font-mono text-sm lg:text-base">
                                        <Link href={`/address/${holder.address}`} className="text-primary hover:underline">
                                            {holder.address}
                                        </Link>
                                    </td>
                                    <td className="px-6 py-4 text-right font-semibold text-sm lg:text-base">
                                        <Amount value={holder.balance} decimals={assetData.units} grouping />
                                    </td>
                                </tr>
                            ))}
                            {holders.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">
                                        No holders found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
