'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Peer } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function PeersPage() {
    const [skip, setSkip] = useState(0);
    const limit = 20;

    const { data: peers, isLoading, error } = useQuery<Peer[]>({
        queryKey: ['peers'],
        queryFn: api.getPeers,
        refetchInterval: 10000 // Refresh every 10s
    });

    if (isLoading) return <div className="text-center p-8 text-muted-foreground">Loading Peers...</div>;
    if (error) return <div className="text-center p-8 text-destructive">Error loading peers</div>;

    const displayedPeers = peers?.slice(skip, skip + limit) || [];

    return (
        <div className="flex flex-col gap-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
                    Node Peers
                </h1>
                <span className="text-muted-foreground text-sm font-mono bg-muted/30 px-3 py-1 rounded">
                    Total: <span className="text-primary font-bold">{peers?.length || 0}</span>
                </span>
            </div>

            <Card className="border-2 lg:border">
                <div className="flex flex-col">
                    <div className="block lg:hidden">
                        <div className="flex flex-col divide-y-2 divide-border">
                            {displayedPeers.map((peer) => (
                                <div key={peer.id} className="p-4">
                                    <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-left text-[15px]">
                                        <div className="font-semibold text-muted-foreground">Address</div>
                                        <div className="font-mono text-primary">{peer.addr}</div>
                                        <div className="border-t border-dashed border-border col-span-2" />
                                        <div className="font-semibold text-muted-foreground">Version</div>
                                        <div className="font-mono text-muted-foreground">
                                            {peer.subver.replace(/\//g, '')}
                                            <span className="text-muted-foreground/60"> v{peer.version}</span>
                                        </div>
                                        <div className="border-t border-dashed border-border col-span-2" />
                                        <div className="font-semibold text-muted-foreground">Synced</div>
                                        <div className="font-mono">{peer.synced_blocks}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="hidden lg:block overflow-x-auto text-sm lg:text-base">
                        <table className="w-full text-left">
                            <thead className="bg-muted/40 text-muted-foreground font-medium uppercase text-sm border-b border-border">
                                <tr>
                                    <th className="p-4">Address</th>
                                    <th className="p-4">Version</th>
                                    <th className="p-4">Height</th>
                                    <th className="p-4">Synced Blocks</th>
                                    <th className="p-4">Ping</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {displayedPeers.map((peer) => (
                                    <tr key={peer.id} className="hover:bg-muted/10 transition-colors">
                                        <td className="p-4">
                                            <span className="font-mono text-primary font-medium">{peer.addr}</span>
                                        </td>
                                        <td className="p-4 font-mono text-muted-foreground">
                                            {peer.subver.replace(/\//g, '')}
                                            <div className="text-sm text-muted-foreground/60">v{peer.version}</div>
                                        </td>
                                        <td className="p-4 font-mono">
                                            {peer.startingheight?.toLocaleString() || 'N/A'}
                                        </td>
                                        <td className="p-4 font-mono">{peer.synced_blocks}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded text-sm font-mono font-bold ${(peer.pingtime || 0) < 0.1 ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                                                (peer.pingtime || 0) < 0.5 ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                                                    'bg-red-500/20 text-red-600 dark:text-red-400'
                                                }`}>
                                                {((peer.pingtime || 0) * 1000).toFixed(0)} ms
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between p-4 border-t border-border">
                        <button
                            onClick={() => setSkip(Math.max(0, skip - limit))}
                            disabled={skip === 0}
                            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Newer</span>
                        </button>
                        <span className="text-sm text-muted-foreground">
                            Peers {skip + 1} - {skip + displayedPeers.length}
                        </span>
                        <button
                            onClick={() => setSkip(skip + limit)}
                            disabled={!peers || skip + limit >= peers.length}
                            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>Older</span>
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </Card>
        </div>
    );
}
