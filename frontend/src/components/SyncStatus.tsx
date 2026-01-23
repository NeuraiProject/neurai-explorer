'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import config from '../config.json';
import { cn } from '@/lib/utils';

export function SyncStatus() {
    const [isPinned, setIsPinned] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const containerRef = useRef<HTMLButtonElement | null>(null);
    const { data: status, isLoading: statusLoading } = useQuery({
        queryKey: ['status'],
        queryFn: api.getStatus,
        refetchInterval: config.ui.pollingInterval
    });

    const { data: peers, isLoading: peersLoading } = useQuery({
        queryKey: ['peers'],
        queryFn: api.getPeers,
        refetchInterval: config.ui.pollingInterval
    });

    useEffect(() => {
        if (!isPinned) return;
        const handleClick = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setIsPinned(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, [isPinned]);

    if (statusLoading || peersLoading) return null;

    const explorerHeight = status?.blockbook.bestHeight ?? 0;
    const nodeHeight = status?.backend.blocks ?? 0;
    const networkHeight = peers && peers.length > 0
        ? Math.max(...peers.map(p => (p.syncedHeaders || p.synced_headers || p.startingheight || 0)))
        : nodeHeight;

    const isNodeSynced = nodeHeight >= networkHeight && nodeHeight > 0;
    const isExplorerSynced = explorerHeight >= nodeHeight && explorerHeight > 0;

    let color = "bg-green-500";
    let statusText = "Synchronized";

    if (!isNodeSynced) {
        color = "bg-red-500";
        statusText = "Node Desynchronized";
    } else if (!isExplorerSynced) {
        color = "bg-orange-500";
        statusText = "Explorer Lagging";
    }

    const showDetails = isPinned || isHovering;

    return (
        <button
            type="button"
            ref={containerRef}
            className="relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border hover:bg-muted/80 transition-colors"
            aria-expanded={showDetails}
            aria-controls="sync-status-details"
            onClick={() => setIsPinned((prev) => !prev)}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
        >
            <div className="relative flex h-2.5 w-2.5">
                {color === "bg-green-500" && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                )}
                <span className={cn(
                    "relative inline-flex rounded-full h-2.5 w-2.5",
                    color
                )}></span>
            </div>

            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground hidden sm:inline-block">Syncr:</span>
                <span className={cn(
                    "text-sm font-mono font-bold",
                    isNodeSynced ? "text-green-600 dark:text-green-400" : "text-red-500"
                )}>
                    {nodeHeight.toLocaleString()}
                </span>
            </div>
            {showDetails && (
                <div
                    id="sync-status-details"
                    className="absolute left-0 top-full mt-2 w-max min-w-full rounded-lg border border-border bg-background shadow-lg p-3 text-left text-xs text-muted-foreground"
                >
                    <div className="font-medium text-foreground">{statusText}</div>
                    <div className="mt-2 grid gap-1">
                        <div className="flex items-center justify-between gap-3">
                            <span>Explorer</span>
                            <span className="font-mono text-foreground">{explorerHeight.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span>Node</span>
                            <span className="font-mono text-foreground">{nodeHeight.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span>Network</span>
                            <span className="font-mono text-foreground">{networkHeight.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            )}
        </button>
    );
}
