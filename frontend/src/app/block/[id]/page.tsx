'use client'

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { TxIdDisplay } from '@/components/TxIdDisplay';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Transaction } from "@/types";
import { getTotalOutput } from '@/lib/utils';
import { Amount } from '@/components/ui/Amount';

export default function BlockPage() {
    const { id } = useParams();
    const hashOrHeight = id as string;

    const { data: block, isLoading, error } = useQuery({
        queryKey: ['block', hashOrHeight],
        queryFn: () => api.getBlock(hashOrHeight),
        enabled: !!hashOrHeight
    });

    if (isLoading) return <div className="text-center p-8 text-muted-foreground">Loading Block...</div>;
    if (error) return <div className="text-center p-8 text-destructive">Error loading block</div>;
    if (!block) return <div className="text-center p-8 text-destructive">Block not found</div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 mb-2"><span className="eyebrow">Block</span><h1 className="text-2xl lg:text-3xl font-bold tracking-tight font-mono">#{block.height}</h1></div>

            <Card title="Overview">
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    <div className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Hash</span>
                        <span className="mono-box text-sm lg:text-base">{block.hash}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Confirmations</span>
                        <span className="font-mono text-sm lg:text-base">{block.confirmations}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Time</span>
                        <span className="font-mono text-sm lg:text-base">{new Date(block.time * 1000).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Size</span>
                        <span className="font-mono">{block.size} bytes</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Nonce</span>
                        <span className="font-mono">{block.nonce64}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Difficulty</span>
                        <span className="font-mono">{parseFloat(block.difficulty).toFixed(4)}</span>
                    </div>
                    <div className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Merkle Root</span>
                        <span className="font-mono text-sm break-all">{block.merkleRoot || block.merkleroot}</span>
                    </div>
                    {block.previousblockhash && (
                        <div className="flex flex-col gap-1 md:col-span-2">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Previous Block</span>
                            <Link href={`/block/${block.previousblockhash}`} className="mono-box text-sm hover:text-primary transition-colors">
                                {block.previousblockhash}
                            </Link>
                        </div>
                    )}
                    {block.nextblockhash && (
                        <div className="flex flex-col gap-1 md:col-span-2">
                            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Next Block</span>
                            <Link href={`/block/${block.nextblockhash}`} className="mono-box text-sm hover:text-primary transition-colors">
                                {block.nextblockhash}
                            </Link>
                        </div>
                    )}
                </div>
            </Card>

            <div className="space-y-4">
                <h2 className="text-2xl font-semibold">Transactions ({block.tx.length})</h2>
                <div className="space-y-4">
                    <div className="hidden lg:grid grid-cols-[65%_35%] gap-4 px-4 py-3 text-sm text-muted-foreground uppercase bg-muted/50 border-b border-border">
                        <div>Transaction</div>
                        <div className="text-right pr-2">Total Output</div>
                    </div>
                    {block.tx.map((tx: Transaction) => (
                        <Card key={tx.txid}>
                            <div className="p-4 flex flex-col lg:grid lg:grid-cols-[65%_35%] lg:items-center gap-2 lg:gap-4">
                                <div className="flex flex-col min-w-0">
                                    <Link href={`/tx/${tx.txid}`} className="block w-full min-w-0 overflow-hidden text-primary font-mono text-sm lg:text-base hover:underline">
                                        <TxIdDisplay txid={tx.txid} className="text-sm lg:text-base" />
                                    </Link>
                                </div>
                                <div className="flex items-center justify-end pr-2">
                                    <Amount value={getTotalOutput(tx)} unit="XNA" className="font-medium text-green-600 dark:text-green-400" />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
