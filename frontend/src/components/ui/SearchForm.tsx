'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { sanitizeInput, getSearchQueryType } from '@/lib/validation';

export function SearchForm({ className }: { className?: string }) {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const sanitized = sanitizeInput(query);
        if (!sanitized) return;

        const queryType = getSearchQueryType(sanitized);

        if (queryType === 'invalid') {
            setError('Invalid search. Enter a block height, tx hash, or address.');
            return;
        }

        setIsLoading(true);
        try {
            switch (queryType) {
                case 'block_height':
                    router.push(`/block/${sanitized}`);
                    break;
                case 'hash':
                    // 64-char hex could be txid or block hash, default to tx
                    router.push(`/tx/${sanitized}`);
                    break;
                case 'address':
                    router.push(`/address/${sanitized}`);
                    break;
            }
        } finally {
            setIsLoading(false);
            setQuery('');
        }
    };

    return (
        <form onSubmit={handleSubmit} className={`w-full max-w-sm ${className || ''}`}>
            <div className="flex flex-col">
                <div className="relative flex items-center bg-muted/40 border-2 border-border/60 hover:border-primary/50 shadow-sm rounded-md px-3 py-1.5 transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                    <Search className="text-muted-foreground mr-2" size={18} />
                    <input
                        type="text"
                        placeholder="Search Block, Tx, or Address..."
                        className="bg-transparent border-none text-foreground w-full outline-none text-sm py-1 placeholder:text-muted-foreground/60"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setError(null);
                        }}
                        disabled={isLoading}
                        maxLength={128}
                    />
                </div>
                {error && (
                    <span className="text-xs text-destructive mt-1 px-1">{error}</span>
                )}
            </div>
        </form>
    );
}
