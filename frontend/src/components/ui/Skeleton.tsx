import { cn } from '@/lib/utils';

interface SkeletonProps {
    className?: string;
}

/**
 * Basic skeleton element with pulse animation
 */
export function Skeleton({ className }: SkeletonProps) {
    return (
        <div className={cn("bg-muted animate-pulse rounded", className)} />
    );
}

/**
 * Skeleton for stat cards (dashboard style)
 */
export function StatCardSkeleton() {
    return (
        <div className="bg-card border border-border p-6 rounded-xl shadow-sm">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-32" />
        </div>
    );
}

/**
 * Skeleton for chart/graph containers
 */
export function ChartSkeleton({ height = 250 }: { height?: number }) {
    const innerHeight = height - 60;
    return (
        <div
            className="w-full bg-card/50 border border-border/50 rounded-xl p-4"
            style={{ height }}
        >
            <Skeleton className="h-4 w-48 mb-4" />
            <div
                className="bg-muted animate-pulse rounded-lg w-full"
                style={{ height: innerHeight }}
            />
        </div>
    );
}

/**
 * Skeleton for address/hash display
 */
export function AddressSkeleton() {
    return (
        <Skeleton className="h-6 w-full max-w-md" />
    );
}
