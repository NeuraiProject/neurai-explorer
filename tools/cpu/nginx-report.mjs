#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHistogram } from 'node:perf_hooks';
import routes from '../../frontend/diagnostics/routes.cjs';

export function parseLine(line) {
  // Preserve compatibility with the existing combined log plus cache/rt/rsc.
  const match = line.match(/^\S+ \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]+" (\d{3}) (\d+) "[^"]*" "[^"]*" cache=(\S*) rt=([\d.]+) rsc=([^ ]*)(?: |$)/);
  if (!match) return null;
  const [, date, method, url, status, bytes, cache, seconds, rsc] = match;
  const at = Date.parse(date.replace(/^(\d+)\/(\w+)\/(\d+):/, '$1 $2 $3 '));
  if (!Number.isFinite(at)) return null;
  return { at, method, route: routes.routeGroup(url), kind: routes.requestKind(url, { rsc }),
    status: Number(status), bytes: Number(bytes), cache: cache || '-', ms: Number(seconds) * 1000,
    upstream: line.match(/upstream_status="([^"]*)"/)?.[1] ?? null,
    upstreamMs: (line.match(/upstream_rt="([^"]*)"/)?.[1] ?? '').split(/[, :]+/)
      .filter(s => /^\d+(\.\d+)?$/.test(s)).map(s => Number(s) * 1000) };
}

export async function main(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({ args, options: { log: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' } } });
  if (!v.log) throw new Error('Use --log access.log [--since ISO --until ISO]');
  const since = v.since ? Date.parse(v.since) : -Infinity;
  const until = v.until ? Date.parse(v.until) : Infinity;
  if (Number.isNaN(since) || Number.isNaN(until) || since > until) throw new Error('Invalid time window');
  let matched = 0, skipped = 0, outside = 0;
  const groups = new Map();
  for await (const line of createInterface({ input: createReadStream(v.log), crlfDelay: Infinity })) {
    const row = parseLine(line);
    if (!row) { skipped++; continue; }
    if (row.at < since || row.at >= until) { outside++; continue; }
    matched++;
    const method = ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(row.method) ? row.method : 'OTHER';
    const key = `${method} ${row.kind} ${row.route}`;
    if (!groups.has(key)) groups.set(key, { requests: 0, bytes: 0, errors: 0, cache: {}, upstream_status_present: 0, latency: createHistogram(), upstreamLatency: createHistogram() });
    const group = groups.get(key);
    group.requests++; group.bytes += row.bytes; group.errors += Number(row.status >= 400);
    const cache = ['HIT', 'MISS', 'BYPASS', 'EXPIRED', 'STALE', 'UPDATING', 'REVALIDATED'].includes(row.cache) ? row.cache : '-';
    group.cache[cache] = (group.cache[cache] || 0) + 1;
    group.upstream_status_present += Number(row.upstream !== null && row.upstream !== '-' && row.upstream !== '');
    group.latency.record(Math.max(1, Math.round(row.ms * 1e6)));
    for (const ms of row.upstreamMs) group.upstreamLatency.record(Math.max(1, Math.round(ms * 1e6)));
  }
  const result = { matched, skipped, outside_window: outside, since: v.since ?? null, until: v.until ?? null,
    note: 'Client requests at nginx, NOT exact origin counts or CPU. Use Node metrics for background refreshes. Latency includes the full nginx request.',
    routes: [...groups].map(([key, g]) => ({ key, requests: g.requests, bytes: g.bytes, errors: g.errors,
      cache: g.cache, upstream_status_present: g.upstream_status_present,
      p50_ms: g.latency.percentile(50) / 1e6, p95_ms: g.latency.percentile(95) / 1e6,
      upstream_attempts_timed: g.upstreamLatency.count,
      upstream_p95_ms: g.upstreamLatency.count ? g.upstreamLatency.percentile(95) / 1e6 : null,
    })).sort((a, b) => b.requests - a.requests),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
