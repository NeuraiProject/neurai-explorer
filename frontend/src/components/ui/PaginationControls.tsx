'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
    skip: number;
    limit: number;
    itemCount: number;
    itemName: string;
    onPrevious: () => void;
    onNext: () => void;
    newerLabel?: string;
    olderLabel?: string;
}

export function PaginationControls({
    skip,
    limit,
    itemCount,
    itemName,
    onPrevious,
    onNext,
    newerLabel = 'Newer',
    olderLabel = 'Older',
}: PaginationControlsProps) {
    const hasPrevious = skip > 0;
    const hasNext = itemCount >= limit;

    return (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border">
            <button
                onClick={onPrevious}
                disabled={!hasPrevious}
                className="btn-outline"
            >
                <ChevronLeft className="w-4 h-4" />
                <span>{newerLabel}</span>
            </button>
            <span className="text-xs sm:text-sm text-muted-foreground text-center">
                {itemName} {skip + 1}–{skip + itemCount}
            </span>
            <button
                onClick={onNext}
                disabled={!hasNext}
                className="btn-outline"
            >
                <span>{olderLabel}</span>
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    );
}
