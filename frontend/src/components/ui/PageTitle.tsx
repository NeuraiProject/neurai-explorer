interface PageTitleProps {
    children: React.ReactNode;
}

export function PageTitle({ children }: PageTitleProps) {
    return (
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
            {children}
        </h1>
    );
}
