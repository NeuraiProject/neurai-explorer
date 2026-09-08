#!/usr/bin/env node
// Dependency-free, fixed-workload HTTP measurement and passive Docker sampling.
import http from 'node:http';
import https from 'node:https';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export function dockerGet(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: `/v1.41${path}` }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Docker HTTP ${res.statusCode} for ${path}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Docker sampling timeout')), 5000);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

export function requestOnce(base, entry, timeoutMs = 10000) {
  const url = new URL(entry.path, base);
  if (url.origin !== new URL(base).origin || !entry.path.startsWith('/') || entry.path.startsWith('//')) {
    throw new Error('Workload paths must remain on the target origin');
  }
  return new Promise(resolve => {
    const begin = performance.now();
    let bytes = 0, settled = false, timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, bytes, ms: performance.now() - begin });
    };
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      headers: { 'accept-encoding': 'identity', 'user-agent': 'neurai-cpu-baseline/1', ...entry.headers },
    }, res => {
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) req.destroy(new Error('Response exceeds 64 MiB'));
      });
      res.on('error', error => finish({ error: error.message, status: res.statusCode, transportError: true }));
      res.on('end', () => finish({
        status: res.statusCode,
        contentType: res.headers['content-type'] || '',
        cache: res.headers['x-cache-status'] || 'unreported',
        error: res.statusCode !== (entry.status ?? 200) ? `Unexpected HTTP ${res.statusCode}`
          : entry.contentType && !(res.headers['content-type'] || '').includes(entry.contentType)
            ? 'Unexpected content type' : null,
      }));
    });
    timer = setTimeout(() => req.destroy(new Error('Request timeout')), timeoutMs);
    req.on('error', error => finish({ error: error.message, transportError: true }));
  });
}

export function summarize(rows) {
  const completed = rows.filter(r => r.status !== undefined && !r.transportError);
  const times = rows.map(r => r.ms).sort((a, b) => a - b);
  const percentile = p => times.length ? times[Math.ceil(times.length * p) - 1] : null;
  const counts = key => rows.reduce((out, r) => {
    const value = String(r[key] ?? 'none'); out[value] = (out[value] || 0) + 1; return out;
  }, {});
  return {
    attempts: rows.length, http_responses: completed.length,
    errors: rows.filter(r => r.error).length,
    bytes: rows.reduce((n, r) => n + r.bytes, 0),
    latency_ms: { p50: percentile(0.5), p95: percentile(0.95), max: times.at(-1) ?? null },
    statuses: counts('status'), cache: counts('cache'),
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({ args, options: {
    mode: { type: 'string', default: 'observe' }, base: { type: 'string' },
    workload: { type: 'string' }, containers: { type: 'string', default: '' },
    socket: { type: 'string', default: '/var/run/docker.sock' },
    seconds: { type: 'string', default: '60' }, rounds: { type: 'string', default: '10' },
    concurrency: { type: 'string', default: '4' }, warmup: { type: 'string', default: '0' },
    interval: { type: 'string', default: '1000' }, timeout: { type: 'string', default: '10000' },
    out: { type: 'string' }, label: { type: 'string', default: 'unspecified' },
    'allow-remote': { type: 'boolean', default: false },
  } });
  const integer = (key, min, max) => {
    const n = Number(v[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid --${key}: ${min}..${max}`);
    return n;
  };
  if (!['observe', 'load'].includes(v.mode) || !v.out) throw new Error('Use --mode observe|load and --out result.json');
  try { await access(v.out); throw new Error(`Output already exists: ${v.out}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const interval = integer('interval', 1000, 60000);
  const seconds = integer('seconds', 1, 3600);
  const rounds = integer('rounds', 1, 10000);
  const concurrency = integer('concurrency', 1, 64);
  const warmup = integer('warmup', 0, 1000);
  const timeout = integer('timeout', 100, 60000);
  const names = v.containers.split(',').filter(Boolean);
  if (v.mode === 'observe' && !names.length) throw new Error('Passive mode needs --containers');
  let workload, workloadHash;
  if (v.mode === 'load') {
    if (!v.base || !v.workload) throw new Error('Load mode needs --base and --workload');
    const base = new URL(v.base);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search) throw new Error('--base must be an HTTP(S) origin without credentials');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !v['allow-remote']) throw new Error('Remote load requires --allow-remote and an authorized staging target');
    const raw = await readFile(v.workload, 'utf8');
    workloadHash = createHash('sha256').update(raw).digest('hex');
    workload = JSON.parse(raw);
    if (!Array.isArray(workload.requests) || !workload.requests.length) throw new Error('Workload needs a nonempty requests array');
    if ((rounds + warmup) * workload.requests.length > 100000) throw new Error('Maximum workload size: 100000 attempts including warmup');
    const ids = new Set();
    for (const entry of workload.requests) {
      if (typeof entry.name !== 'string' || ids.has(entry.name)) throw new Error('Each request needs a unique name');
      ids.add(entry.name);
      if (typeof entry.path !== 'string' || !entry.path.startsWith('/') || entry.path.startsWith('//') || new URL(entry.path, base).origin !== base.origin) throw new Error('Invalid workload path');
      for (const key of Object.keys(entry.headers || {})) {
        if (['host', 'authorization', 'cookie', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) throw new Error(`Unsupported workload header: ${key}`);
      }
    }
  }
  const containers = await Promise.all(names.map(async name => {
    const info = await dockerGet(v.socket, `/containers/${encodeURIComponent(name)}/json`);
    return { name, id: info.Id, image: info.Image, started_at: info.State.StartedAt };
  }));
  async function sample() {
    return Promise.all(containers.map(async c => {
      try {
        const data = await dockerGet(v.socket, `/containers/${c.id}/stats?stream=false&one-shot=true`);
        return { name: c.name, at: data.read, cpu_ns: data.cpu_stats.cpu_usage.total_usage,
          memory_bytes: data.memory_stats.usage ?? null,
          pids: data.pids_stats?.current ?? null };
      } catch (error) { return { name: c.name, error: error.message }; }
    }));
  }
  async function run(count) {
    let next = 0;
    const rows = [];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < count * workload.requests.length) {
        const sequence = next++;
        const entry = workload.requests[sequence % workload.requests.length];
        const result = await requestOnce(v.base, entry, timeout);
        rows.push({ sequence, name: entry.name, ...result });
      }
    }));
    return rows;
  }
  if (v.mode === 'load' && warmup) await run(warmup);
  const samples = [await sample()];
  const start = new Date().toISOString(), begin = performance.now();
  let stop = false, wakeSampler;
  // Sampling overlaps requests, but samples never overlap one another.
  const sampler = (async () => {
    while (!stop) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, interval);
        wakeSampler = () => { clearTimeout(timer); resolve(); };
      });
      if (!stop) samples.push(await sample());
    }
  })();
  let rows, end, elapsedMs;
  try {
    rows = v.mode === 'load' ? await run(rounds) : await new Promise(resolve => setTimeout(() => resolve([]), seconds * 1000));
    end = new Date().toISOString(); elapsedMs = performance.now() - begin;
  } finally {
    stop = true;
    wakeSampler?.();
    await sampler;
  }
  samples.push(await sample());
  const summary = summarize(rows);
  const resources = await Promise.all(containers.map(async c => {
    const values = samples.flat().filter(s => s.name === c.name);
    const first = values[0], last = values.at(-1);
    const current = await dockerGet(v.socket, `/containers/${c.id}/json`).catch(() => null);
    const valid = !values.some(s => s.error) && current?.State.StartedAt === c.started_at && last.cpu_ns >= first.cpu_ns;
    const cpuMs = valid ? (last.cpu_ns - first.cpu_ns) / 1e6 : null;
    return { ...c, valid, cpu_ms: cpuMs,
      sample_start: first.at, sample_end: last.at,
      // CPU includes all container work in the sample window. No attribution to SQL/requests.
      cpu_ms_per_attempt: valid && rows.length ? cpuMs / rows.length : null,
      cpu_ms_per_http_response: valid && summary.http_responses ? cpuMs / summary.http_responses : null,
      peak_sampled_memory_bytes: Math.max(0, ...values.map(s => s.memory_bytes || 0)),
    };
  }));
  const report = {
    schema: 1, mode: v.mode, label: v.label, start, end, elapsed_ms: elapsedMs,
    client_node: process.version, base: v.base ?? null, workload_sha256: workloadHash ?? null,
    workload: workload ?? null, rounds: v.mode === 'load' ? rounds : null, concurrency,
    warmup_rounds: warmup, sample_interval_ms: interval, summary, resources,
    by_request: workload ? Object.fromEntries(workload.requests.map(e => [e.name, summarize(rows.filter(r => r.name === e.name))])) : {},
    samples, requests: rows.sort((a, b) => a.sequence - b.sequence),
    notes: ['Closed-loop fixed workload; no automatic retries or redirects.',
      'Container CPU includes background work and sampling boundary overhead; memory includes cache, not just RSS.',
      'HTTP bytes are response body bytes on the wire; latency includes full body or time to failure.',
      'Passive mode has no request denominator; pair with Node metrics from the same window.'],
  };
  await writeFile(v.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: v.out, mode: v.mode, summary, resources }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
