'use strict';

// Loaded before Next by PM2. No subscriptions or timers unless explicitly enabled.
if (process.env.EXPLORER_METRICS === '1') start();

function start() {
  const dc = require('node:diagnostics_channel');
  const { performance, createHistogram, PerformanceObserver } = require('node:perf_hooks');
  const { mkdir, writeFile } = require('node:fs/promises');
  const path = require('node:path');
  const { routeGroup, requestKind } = require('./routes.cjs');
  const intervalMs = boundedEnv('EXPLORER_METRICS_INTERVAL_MS', 10000, 1000, 60000);
  const groups = new Map();
  let active = 0;
  let started = 0;
  let gcMs = 0;
  let gcCount = 0;
  let profiling = false;
  let previousCpu = process.cpuUsage();
  let previousTime = performance.now();
  let skippedFlushes = 0;

  function group(key) {
    if (!groups.has(key)) groups.set(key, {
      completed: 0, aborted: 0, statuses: {}, latency: createHistogram(),
    });
    return groups.get(key);
  }

  dc.subscribe('http.server.request.start', ({ request, response }) => {
    // Classify before Next rewrites the request. Never retain query strings or IDs.
    const method = ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER';
    const key = `${method} ${requestKind(request.url, request.headers)} ${routeGroup(request.url)}`;
    const begin = performance.now();
    started++;
    active++;
    let settled = false;
    function settle(aborted) {
      if (settled) return;
      settled = true;
      active--;
      const row = group(key);
      if (aborted) row.aborted++;
      else {
        row.completed++;
        const status = String(response.statusCode);
        row.statuses[status] = (row.statuses[status] || 0) + 1;
        row.latency.record(Math.max(1, Math.round((performance.now() - begin) * 1e6)));
      }
    }
    response.once('finish', () => settle(false));
    response.once('close', () => settle(!response.writableFinished));
  });

  const gc = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) { gcMs += entry.duration; gcCount++; }
  });
  gc.observe({ entryTypes: ['gc'] });

  function flush() {
    // Do not build an unbounded logging queue when the log collector stalls.
    if (process.stdout.writableNeedDrain || process.stdout.destroyed) { skippedFlushes++; return; }
    const now = performance.now();
    const cpu = process.cpuUsage();
    const cpuMs = (cpu.user - previousCpu.user + cpu.system - previousCpu.system) / 1000;
    const routes = [...groups].map(([key, row]) => ({
      key, completed: row.completed, aborted: row.aborted, statuses: row.statuses,
      latency_ms: row.completed ? {
        p50: row.latency.percentile(50) / 1e6,
        p95: row.latency.percentile(95) / 1e6,
        max: row.latency.max / 1e6,
      } : null,
    }));
    const completed = routes.reduce((n, r) => n + r.completed, 0);
    process.stdout.write(JSON.stringify({
      event: 'explorer_metrics', schema: 1, at: new Date().toISOString(),
      pid: process.pid, worker: process.env.NODE_APP_INSTANCE ?? null,
      node: process.version, uptime_s: process.uptime(), window_ms: now - previousTime,
      started, completed, active,
      aborted: routes.reduce((n, r) => n + r.aborted, 0),
      cpu_ms: cpuMs, cpu_total_us: cpu.user + cpu.system,
      // Process-wide window ratio, NOT CPU attributed to an individual request/route.
      cpu_ms_per_completed: completed ? cpuMs / completed : null,
      memory: process.memoryUsage(), gc_ms: gcMs, gc_count: gcCount,
      skipped_flushes: skippedFlushes, profiling, routes,
    }) + '\n');
    previousTime = now; previousCpu = cpu;
    started = 0; gcMs = 0; gcCount = 0; skippedFlushes = 0;
    groups.clear();
  }
  setInterval(flush, intervalMs).unref();
  process.once('exit', flush);

  // Local signal only: does not open a debugging port or add a public HTTP endpoint.
  process.on('SIGUSR2', async () => {
    if (profiling) return;
    profiling = true;
    let session;
    try {
      const { Session } = require('node:inspector/promises');
      session = new Session();
      session.connect();
      const duration = boundedEnv('EXPLORER_CPU_PROFILE_MS', 60000, 1000, 300000);
      const directory = process.env.EXPLORER_CPU_PROFILE_DIR || '/tmp/explorer-cpu';
      await mkdir(directory, { recursive: true });
      await session.post('Profiler.enable');
      await session.post('Profiler.start');
      process.stdout.write(JSON.stringify({ event: 'explorer_profile_start', pid: process.pid, duration_ms: duration }) + '\n');
      await new Promise(resolve => setTimeout(resolve, duration));
      const { profile } = await session.post('Profiler.stop');
      const file = path.join(directory, `cpu-${process.pid}-${Date.now()}.cpuprofile`);
      await writeFile(file, JSON.stringify(profile), { mode: 0o600 });
      process.stdout.write(JSON.stringify({ event: 'explorer_profile_saved', pid: process.pid, file }) + '\n');
    } catch (error) {
      process.stderr.write(JSON.stringify({ event: 'explorer_profile_error', pid: process.pid, message: error.message }) + '\n');
    } finally {
      session?.disconnect();
      profiling = false;
    }
  });
}

function boundedEnv(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
