'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { sanitizeInput, getSearchQueryType } from '@/lib/validation';

export function SearchForm({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
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
                <div className={`flex items-center gap-2 rounded-inner border border-input-border bg-card px-3 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary ${size === 'lg' ? 'py-2.5 shadow-card' : 'py-1.5'}`}>
                    <Search className="text-muted-foreground shrink-0" size={18} />
                    <input
                        type="text"
                        placeholder="Search block, transaction or address"
                        className={`bg-transparent border-none text-foreground w-full min-w-0 outline-none py-1.5 placeholder:text-subtle ${size === 'lg' ? 'text-base' : 'text-sm'}`}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setError(null);
                        }}
                        disabled={isLoading}
                        maxLength={128}
                    />
                    <button type="submit" className="btn-primary hidden sm:inline-flex py-1.5" disabled={isLoading || !query}>
                        Search
                    </button>
                </div>
                {error && (
                    <span className="text-xs text-destructive mt-1 px-1">{error}</span>
                )}
            </div>
        </form>
    );
}
