import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
    children: ReactNode;
    className?: string;
    /** Rendered as a small uppercase label at the top of the card */
    title?: string;
    /** Optional element on the right of the title (badge, action) */
    action?: ReactNode;
}

export function Card({ children, className, title, action }: CardProps) {
    return (
        <div className={cn("rounded-card overflow-hidden bg-card border border-border shadow-card", className)}>
            {(title || action) && (
                <div className="flex items-center justify-between gap-3 px-5 lg:px-6 pt-4 pb-3 border-b border-border">
                    {title && <h3 className="eyebrow">{title}</h3>}
                    {action}
                </div>
            )}
            <div className="p-0">{children}</div>
        </div>
    );
}
