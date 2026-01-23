import prisma from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { TxIdDisplay } from "@/components/TxIdDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Asset } from "@/types"; // We will map the DB result to this interface

export const dynamic = 'force-dynamic';

interface Holder {
    address: string;
    balance: number;
}

export default async function AssetPage({ params }: { params: Promise<{ name: string }> }) {
    const { name } = await params;
    const assetName = decodeURIComponent(name);

    let assetData: Asset | null = null;
    let holders: Holder[] = [];

    try {
        const [asset, holdersRes] = await Promise.all([
            prisma.asset.findUnique({ where: { name: assetName } }),
            prisma.addressAsset.findMany({
                where: { assetName },
                orderBy: { balance: 'desc' },
                select: { address: true, balance: true }
            })
        ]);

        if (asset) {
            assetData = {
                name: asset.name,
                amount: Number(asset.amount ?? 0),
                units: asset.units ?? 0,
                reissuable: asset.reissuable ?? false,
                hasIpfs: asset.hasIpfs ?? false,
                ipfsHash: asset.ipfsHash || undefined, // Map null to undefined to match interface
                txid: asset.txid || "",
                blockHeight: asset.blockHeight ?? 0,
                type: asset.type ?? "asset", // Default type if missing
                // Add missing properties from interface if not present in DB result, or map optional ones
            };

            // Note: Our Asset interface in types/index.ts uses 'ipfsHash', but the page code used 'ipfs_hash'
            // We need to either update the interface or the code using it. 
            // In types/index.ts: ipfsHash?: string;
            // In this file usage: assetData.ipfs_hash
            // I will update the usage in the rest of the file to match the interface property names (camelCase).

            holders = holdersRes.map((h: { address: string, balance: any }) => ({
                address: h.address,
                balance: Number(h.balance)
            }));
        }
    } catch (e) {
        console.error("Error fetching asset:", e);
    }

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
                            <span className="font-mono text-lg">{assetData.amount}</span>
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

            <Card title={`Holders (${holders.length})`}>
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
                                    <td className="px-6 py-4 text-right font-mono font-bold text-sm lg:text-base">
                                        {holder.balance.toLocaleString('en-US', { minimumFractionDigits: assetData.units, maximumFractionDigits: assetData.units })}
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
