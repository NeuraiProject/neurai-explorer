'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, ReactNode } from 'react'
import { RETRY_POLICY, isRetryableError, getRetryDelayMs } from '@/lib/api'

export default function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 10 * 1000,
                refetchOnWindowFocus: false,
                // The ONLY retry policy: the fetcher never retries on its own.
                // Nothing is repeated for 4xx or cancelled requests, and a
                // 429 `Retry-After` is honoured instead of hammering the API.
                retry: (failureCount, error) =>
                    failureCount < RETRY_POLICY.attempts && isRetryableError(error),
                retryDelay: (attempt, error) =>
                    getRetryDelayMs(attempt, error, RETRY_POLICY.baseDelayMs),
            },
        },
    }))

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
