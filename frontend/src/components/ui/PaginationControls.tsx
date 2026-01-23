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
        <div className="flex items-center justify-between p-4 border-t border-border">
            <button
                onClick={onPrevious}
                disabled={!hasPrevious}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <ChevronLeft className="w-4 h-4" />
                <span>{newerLabel}</span>
            </button>
            <span className="text-sm text-muted-foreground">
                {itemName} {skip + 1} - {skip + itemCount}
            </span>
            <button
                onClick={onNext}
                disabled={!hasNext}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <span>{olderLabel}</span>
                <ChevronRight className="w-4 h-4" />
            </button>
        </div>
    );
}
