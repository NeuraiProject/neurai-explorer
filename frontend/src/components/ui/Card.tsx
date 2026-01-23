import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
    children: ReactNode;
    className?: string;
    title?: string;
}

export function Card({ children, className, title }: CardProps) {
    return (
        <div className={cn("rounded-lg overflow-hidden bg-card border border-border shadow-sm", className)}>
            {title && <h3 className="px-6 py-4 text-lg font-semibold border-b border-border bg-muted/30 text-card-foreground">{title}</h3>}
            <div className="p-0">{children}</div>
        </div>
    );
}
