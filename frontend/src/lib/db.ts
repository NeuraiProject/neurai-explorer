import { channel } from 'node:diagnostics_channel';
import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

function createClient() {
  if (process.env.EXPLORER_METRICS === '1') {
    const queries = channel('explorer.db.query');
    const client = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'error' }],
    });
    client.$on('query', event => {
      // Never publish SQL, parameters, identifiers, or connection details.
      queries.publish({ duration_ms: event.duration });
    });
    return client;
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalThis.prisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export default prisma;
