interface PageTitleProps {
    children: React.ReactNode;
    /** Small uppercase label shown above the title */
    eyebrow?: string;
    /** Optional right-hand content (search box, actions) */
    actions?: React.ReactNode;
}

export function PageTitle({ children, eyebrow, actions }: PageTitleProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="flex flex-col gap-1">
                {eyebrow && <span className="eyebrow">{eyebrow}</span>}
                <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{children}</h1>
            </div>
            {actions}
        </div>
    );
}
