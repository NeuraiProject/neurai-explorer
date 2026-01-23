'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiAsset } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PaginationControls } from '@/components/ui/PaginationControls';
import config from '../../config.json';

export default function AssetsPage() {
    const [skip, setSkip] = useState(0);
    const limit = config.ui.pagination?.defaultLimit ?? 20;

    const { data: assets, isLoading } = useQuery<ApiAsset[]>({
        queryKey: ['assetsPage', skip],
        queryFn: () => api.getLatestAssets(limit, skip),
        refetchInterval: config.ui.pollingInterval,
        staleTime: config.ui.pollingInterval / 2,
    });

    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-6">Assets</h1>
            <Card>
                <div className="flex flex-col">
                    {isLoading && <div className="p-8 text-center text-muted-foreground">Loading assets...</div>}

                    {!isLoading && assets && (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-muted/50">
                                        <tr className="border-b border-border">
                                            <th className="px-6 py-3 font-medium text-muted-foreground w-48 text-sm lg:text-base">Date</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-sm lg:text-base">Name</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-sm lg:text-base">Type</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-right text-sm lg:text-base">Supply</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-center text-sm lg:text-base">Reissuable</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-center text-sm lg:text-base">IPFS</th>
                                            <th className="px-6 py-3 font-medium text-muted-foreground text-right text-sm lg:text-base">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {assets.map((asset) => (
                                            <tr key={asset.name} className="border-b border-border hover:bg-muted/50 transition-colors">
                                                <td className="px-6 py-4 text-muted-foreground whitespace-nowrap text-sm">
                                                    {asset.time ? formatDate(asset.time) : 'Pending...'}
                                                </td>
                                                <td className="px-6 py-4 font-bold text-primary">
                                                    <Link href={`/asset/${asset.name}`} className="hover:underline">
                                                        {asset.name}
                                                    </Link>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {asset.name.includes('#') ? 'Unique' :
                                                        asset.name.includes('/') ? 'Sub-asset' :
                                                            asset.name.startsWith('$') ? 'Restricted' : 'Main'}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono">
                                                    {parseFloat(asset.amount.toString()).toLocaleString('en-US', { minimumFractionDigits: asset.units, maximumFractionDigits: asset.units })}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {asset.reissuable ? (
                                                        <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Yes"></span>
                                                    ) : (
                                                        <span className="inline-block w-2 h-2 rounded-full bg-red-400" title="No"></span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {asset.has_ipfs ? (
                                                        <span className="text-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">IPFS</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <Link href={`/asset/${asset.name}`} className="text-muted-foreground hover:text-primary transition-colors text-sm border border-border rounded px-2 py-1">
                                                        Details
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                        {assets.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                                                    No assets found
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <PaginationControls
                                skip={skip}
                                limit={limit}
                                itemCount={assets.length}
                                itemName="Assets"
                                onPrevious={() => setSkip(Math.max(0, skip - limit))}
                                onNext={() => setSkip(skip + limit)}
                            />
                        </>
                    )}
                </div>
            </Card>
        </div>
    );
}
