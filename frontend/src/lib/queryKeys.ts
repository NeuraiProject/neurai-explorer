/**
 * Centralized React Query key factory
 * Provides consistent and type-safe query keys across the application
 */
export const queryKeys = {
  // Status
  status: ['status'] as const,

  // Blocks
  blocks: {
    all: ['blocks'] as const,
    list: (skip: number) => ['blocks', 'list', skip] as const,
    detail: (hashOrHeight: string | number) => ['blocks', 'detail', hashOrHeight] as const,
  },

  // Transactions
  transactions: {
    all: ['transactions'] as const,
    list: (skip: number, minTotalOutput?: number) => ['transactions', 'list', skip, minTotalOutput ?? null] as const,
    detail: (txid: string) => ['transactions', 'detail', txid] as const,
  },

  // Addresses
  addresses: {
    detail: (address: string) => ['addresses', 'detail', address] as const,
    transactions: (address: string, skip: number) => ['addresses', 'transactions', address, skip] as const,
  },

  // Assets
  assets: {
    all: ['assets'] as const,
    list: (skip: number) => ['assets', 'list', skip] as const,
    detail: (name: string) => ['assets', 'detail', name] as const,
  },

  // Network
  peers: ['peers'] as const,
  richlist: ['richlist'] as const,

  // Stats
  stats: {
    network: ['stats', 'network'] as const,
    history: ['stats', 'history'] as const,
    daily: ['stats', 'daily'] as const,
  },

  // Home page widgets
  home: {
    latestBlocks: (skip: number) => ['home', 'latestBlocks', skip] as const,
    latestTxs: (skip: number) => ['home', 'latestTxs', skip] as const,
  },
} as const;
