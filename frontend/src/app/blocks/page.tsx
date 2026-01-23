'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate, formatNumber } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { PageTitle } from '@/components/ui/PageTitle';
import { PaginationControls } from '@/components/ui/PaginationControls';
import Link from 'next/link';
import config from '../../config.json';

export default function BlocksPage() {
    const [skip, setSkip] = useState(0);
    const limit = 20;

    const { data: blocks, isLoading } = useQuery({
        queryKey: queryKeys.blocks.list(skip),
        queryFn: () => api.getLatestBlocks(limit, skip),
        refetchInterval: config.ui.pollingInterval
    });

    return (
        <div className="flex flex-col gap-8 w-full">
            <PageTitle>Latest Blocks</PageTitle>

            <Card className="bg-card text-card-foreground border-border">
                <div className="flex flex-col">
                    {isLoading && <div className="p-8 text-center text-muted-foreground">Loading blocks...</div>}

                    {!isLoading && blocks && (
                        <>
                            <div className="w-full overflow-x-auto text-sm lg:text-base hidden lg:block">
                                <table className="w-full text-left">
                                    <thead className="text-sm text-muted-foreground uppercase bg-muted/50 border-b border-border">
                                        <tr>
                                            <th className="px-6 py-3">Height</th>
                                            <th className="px-6 py-3">Size</th>
                                            <th className="px-6 py-3">Time</th>
                                            <th className="px-6 py-3">Transactions</th>
                                            <th className="px-6 py-3">Hash</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {blocks.map((block) => (
                                            <tr key={block.hash} className="bg-card border-b border-border hover:bg-muted/50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <Link href={`/block/${block.height}`} className="font-bold text-primary hover:underline">
                                                        {block.height}
                                                    </Link>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {formatNumber(block.size / 1024)} kB
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {formatDate(block.time)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {block.txCount}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-muted-foreground truncate max-w-[200px]">
                                                    {block.hash}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex flex-col lg:hidden">
                                {blocks.map((block) => (
                                    <div key={block.hash} className="grid grid-cols-[72px_1fr] gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center justify-center text-center">
                                            <Link href={`/block/${block.height}`} className="font-bold text-primary hover:underline">
                                                {block.height}
                                            </Link>
                                        </div>
                                        <div className="flex flex-col gap-2 min-w-0">
                                            <div className="font-mono text-muted-foreground truncate">
                                                {block.hash}
                                            </div>
                                            <div className="grid grid-cols-3 items-center text-sm text-muted-foreground">
                                                <span className="whitespace-nowrap">{formatNumber(block.size / 1024)} kB</span>
                                                <span className="text-center whitespace-nowrap">{block.txCount} txs</span>
                                                <span className="text-right whitespace-nowrap">
                                                    {formatDate(block.time, { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <PaginationControls
                                skip={skip}
                                limit={limit}
                                itemCount={blocks.length}
                                itemName="Blocks"
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
