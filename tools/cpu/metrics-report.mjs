#!/usr/bin/env node
// Accepts plain Node JSONL or `docker logs`/PM2 output with a prefix before JSON.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
const { values: v } = parseArgs({ options: { log: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' } } });
if (!v.log) throw new Error('Use --log node.log [--since ISO --until ISO]');
const since = v.since ? Date.parse(v.since) : -Infinity;
const until = v.until ? Date.parse(v.until) : Infinity;
if (Number.isNaN(since) || Number.isNaN(until) || since > until) throw new Error('Invalid time window');
const workers = new Map();
let boundaryWindows = 0;
for await (const line of createInterface({ input: createReadStream(v.log), crlfDelay: Infinity })) {
  let row;
  try { row = JSON.parse(line.slice(line.indexOf('{'))); } catch { continue; }
  if (row.event !== 'explorer_metrics') continue;
  const end = Date.parse(row.at), start = end - row.window_ms;
  if (end < since || start > until) continue;
  // Never pretend that half of a reporting interval contains half its requests.
  if (start < since || end > until) { boundaryWindows++; continue; }
  const key = `${row.pid}:${Math.round(end / 1000 - row.uptime_s)}`;
  if (!workers.has(key)) workers.set(key, { pid: row.pid, windows: 0, cpu_ms: 0, completed: 0, aborted: 0,
    gc_ms: 0, peak_sampled_rss: 0, first: row.at, last: row.at, profiling: false,
    db: { observed_windows: 0, queries: 0, duration_ms: 0, max_ms: 0 },
    event_loop: { observed_windows: 0, active_ms: 0, idle_ms: 0, delay_max_ms: null }, routes: {} });
  const w = workers.get(key);
  w.windows++; w.cpu_ms += row.cpu_ms; w.completed += row.completed; w.aborted += row.aborted;
  w.gc_ms += row.gc_ms; w.peak_sampled_rss = Math.max(w.peak_sampled_rss, row.memory.rss);
  w.last = row.at; w.profiling ||= row.profiling;
  if (row.db) {
    w.db.observed_windows++;
    w.db.queries += row.db.queries;
    w.db.duration_ms += row.db.duration_ms;
    w.db.max_ms = Math.max(w.db.max_ms, row.db.max_ms);
  }
  if (row.event_loop) {
    w.event_loop.observed_windows++;
    w.event_loop.active_ms += row.event_loop.active_ms;
    w.event_loop.idle_ms += row.event_loop.idle_ms;
    if (row.event_loop.delay_max_ms !== null) {
      w.event_loop.delay_max_ms = Math.max(w.event_loop.delay_max_ms ?? 0, row.event_loop.delay_max_ms);
    }
  }
  for (const r of row.routes) {
    const g = w.routes[r.key] ||= { completed: 0, aborted: 0, statuses: {}, diagnostic_completions: 0, prefetch_hints: 0, next_cache: {} };
    g.completed += r.completed; g.aborted += r.aborted;
    if (r.prefetch_hints !== undefined) {
      g.diagnostic_completions += r.completed;
      g.prefetch_hints += r.prefetch_hints;
      for (const [state, count] of Object.entries(r.next_cache || {})) g.next_cache[state] = (g.next_cache[state] || 0) + count;
    }
    for (const [status, count] of Object.entries(r.statuses)) g.statuses[status] = (g.statuses[status] || 0) + count;
  }
}
const results = [...workers.values()];
for (const w of results) {
  if (!w.db.observed_windows) w.db = null;
  if (!w.event_loop.observed_windows) w.event_loop = null;
  else {
    const total = w.event_loop.active_ms + w.event_loop.idle_ms;
    w.event_loop.utilization = total ? w.event_loop.active_ms / total : 0;
  }
}
const cpu = results.reduce((n, w) => n + w.cpu_ms, 0);
const completed = results.reduce((n, w) => n + w.completed, 0);
console.log(JSON.stringify({ windows_crossing_boundary_excluded: boundaryWindows, cpu_ms: cpu, completed,
  cpu_ms_per_completed: completed ? cpu / completed : null, workers: results,
  note: 'Only complete metric windows are included. CPU is per process, never attributed to individual concurrent routes. Do not average window p95s; use the workload/raw nginx report for the full-window percentile.',
}, null, 2));
