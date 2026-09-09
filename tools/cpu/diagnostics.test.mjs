import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestOnce, summarize, main as measure } from './measure.mjs';
import { parseLine } from './nginx-report.mjs';

const runtime = fileURLToPath(new URL('../../frontend/diagnostics/runtime.cjs', import.meta.url));

test('nginx parser includes BYPASS RSC and does not leak entity/query values', () => {
  const line = '1.2.3.4 - - [08/Sep/2026:15:01:02 +0200] "GET /address/private?page=2&_rsc=abc HTTP/2.0" 200 120 "-" "agent" cache=BYPASS rt=0.125 rsc=1 upstream_addr="127.0.0.1:3333" upstream_status="200" upstream_rt="0.120"';
  const row = parseLine(line);
  assert.equal(row.route, '/address/*');
  assert.equal(row.kind, 'rsc');
  assert.equal(row.cache, 'BYPASS');
  assert.equal(row.at, Date.parse('2026-09-08T13:01:02Z'));
  assert.equal(row.ms, 125);
  const old = parseLine(line.replace('rsc=1 upstream_addr="127.0.0.1:3333" upstream_status="200" upstream_rt="0.120"', 'rsc='));
  assert.equal(old.kind, 'html');
  assert.equal(old.upstream, null);
});

test('load measurement reads full streamed body, records errors and does not follow redirects', async t => {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    if (req.url === '/redirect') { res.writeHead(302, { location: '/' }); res.end(); return; }
    if (req.url === '/timeout') return;
    if (req.url === '/broken') { res.write('partial'); setTimeout(() => res.destroy(), 10); return; }
    res.setHeader('content-type', 'application/json');
    res.write('abc'); setTimeout(() => res.end('defgh'), 20);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ok = await requestOnce(base, { path: '/', contentType: 'application/json' });
  assert.equal(ok.bytes, 8); assert.ok(ok.ms >= 15); assert.equal(ok.error, null);
  const redirect = await requestOnce(base, { path: '/redirect' });
  assert.equal(count, 2); assert.equal(redirect.status, 302); assert.ok(redirect.error);
  const timeout = await requestOnce(base, { path: '/timeout' }, 50);
  assert.equal(timeout.error, 'Request timeout');
  const broken = await requestOnce(base, { path: '/broken' });
  const stats = summarize([ok, redirect, timeout, broken]);
  assert.equal(stats.http_responses, 2); assert.equal(stats.errors, 3);
  assert.throws(() => requestOnce(base, { path: '//example.com/' }));
});

test('remote load is rejected before requests are sent', async () => {
  await assert.rejects(measure(['--mode', 'load', '--base', 'https://example.com', '--workload', '/missing', '--out', '/unused']), /Remote load requires/);
});

test('fixed workload report preserves counts and Docker CPU deltas, and refuses overwrites', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'explorer-load-test-'));
  let cpu = 0, calls = 0;
  const socket = path.join(directory, 'docker.sock');
  const docker = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('/stats?') ? {
      read: new Date().toISOString(), cpu_stats: { cpu_usage: { total_usage: (cpu += 1000000000) } },
      memory_stats: { usage: 123456 }, pids_stats: { current: 4 },
    } : { Id: 'fake-id', Image: 'fake-image', State: { StartedAt: '2026-01-01T00:00:00Z' } }));
  }).listen(socket);
  const server = http.createServer((req, res) => { calls++; res.end('hello'); }).listen(0, '127.0.0.1');
  await Promise.all([once(docker, 'listening'), once(server, 'listening')]);
  t.after(async () => {
    for (const s of [docker, server]) { s.closeAllConnections(); s.close(); }
    await rm(directory, { recursive: true, force: true });
  });
  const workload = path.join(directory, 'workload.json'), output = path.join(directory, 'out.json');
  await writeFile(workload, JSON.stringify({ requests: [{ name: 'first', path: '/' }, { name: 'second', path: '/other' }] }));
  const args = ['--mode', 'load', '--base', `http://127.0.0.1:${server.address().port}`, '--workload', workload,
    '--rounds', '3', '--warmup', '1', '--concurrency', '2', '--containers', 'test', '--socket', socket, '--out', output];
  const report = await measure(args);
  assert.equal(calls, 8); assert.equal(report.summary.http_responses, 6);
  assert.equal(report.summary.bytes, 30); assert.equal(report.summary.errors, 0);
  assert.equal(report.by_request.first.attempts, 3);
  assert.equal(report.resources[0].cpu_ms, 1000);
  assert.equal(report.resources[0].cpu_ms_per_http_response, 1000 / 6);
  await assert.rejects(measure(args), /Output already exists/);
  assert.equal(calls, 8);
});

test('runtime counts concurrent completions/aborts once and captures a CPU profile without inspector port', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'explorer-metrics-test-'));
  const script = `
    const http=require('node:http');
    const s=http.createServer((req,res)=>{
      if(req.url==='/abort'){res.write('partial');setTimeout(()=>res.destroy(),10);return;}
      require('node:diagnostics_channel').channel('explorer.db.query').publish({duration_ms: 3});
      res.setHeader('x-nextjs-cache', req.url==='/api/status'?'unexpected-private-value':'HIT');
      res.statusCode=req.url==='/api/status'?503:200;
      setTimeout(()=>res.end('ok'),5);
    }).listen(0,'127.0.0.1',()=>process.send(s.address().port));
    process.on('message',()=>{s.closeAllConnections();s.close(()=>process.exit(0));});
  `;
  const child = spawn(process.execPath, ['--require', runtime, '-e', script], {
    env: { ...process.env, EXPLORER_METRICS: '1', EXPLORER_METRICS_INTERVAL_MS: '1000',
      EXPLORER_CPU_PROFILE_MS: '1000', EXPLORER_CPU_PROFILE_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(async () => { if (child.exitCode === null) child.kill(); await rm(directory, { recursive: true, force: true }); });
  let output = '', errors = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { errors += b; });
  const [port] = await once(child, 'message');
  const base = `http://127.0.0.1:${port}`;
  await Promise.all(Array.from({ length: 20 }, (_, i) => requestOnce(base, { path: `/address/entity-${i}?secret=hidden`, headers: { rsc: '1', ...(i < 10 ? { 'next-router-prefetch': '1' } : {}) } })));
  await requestOnce(base, { path: '/api/status' });
  await requestOnce(base, { path: '/abort' });
  child.kill('SIGUSR2');
  const deadline = Date.now() + 10000;
  while (!output.includes('explorer_profile_saved') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert.match(output, /explorer_profile_saved/, errors);
  child.send('stop'); await once(child, 'exit');
  assert.equal(errors, '');
  const records = output.trim().split('\n').map(line => JSON.parse(line));
  const windows = records.filter(r => r.event === 'explorer_metrics');
  assert.equal(windows.reduce((n, r) => n + r.completed, 0), 21);
  assert.equal(windows.reduce((n, r) => n + r.aborted, 0), 1);
  assert.equal(windows.at(-1).active, 0);
  assert.equal(windows.flatMap(w => w.routes).filter(r => r.key === 'GET rsc /address/*').reduce((n, r) => n + r.completed, 0), 20);
  assert.equal(windows.reduce((n, w) => n + w.db.queries, 0), 21);
  assert.equal(windows.reduce((n, w) => n + w.db.duration_ms, 0), 63);
  const routes = windows.flatMap(w => w.routes);
  assert.equal(routes.reduce((n, r) => n + r.prefetch_hints, 0), 10);
  assert.equal(routes.reduce((n, r) => n + (r.next_cache.HIT || 0), 0), 20);
  assert.equal(routes.reduce((n, r) => n + (r.next_cache.UNREPORTED || 0), 0), 1);
  assert.ok(windows.every(w => w.schema === 2 && w.event_loop.utilization >= 0 && w.event_loop.utilization <= 1));
  assert.ok(windows.some(w => w.event_loop.delay_max_ms > 0));
  assert.doesNotMatch(output, /entity-|secret=|unexpected-private-value|Debugger listening/);
  const logFile = path.join(directory, 'metrics.log');
  await writeFile(logFile, output);
  const reportScript = fileURLToPath(new URL('./metrics-report.mjs', import.meta.url));
  const reporter = spawn(process.execPath, [reportScript, '--log', logFile]);
  let reportOutput = '';
  reporter.stdout.on('data', b => { reportOutput += b; });
  const [reportCode] = await once(reporter, 'exit');
  assert.equal(reportCode, 0);
  const report = JSON.parse(reportOutput);
  assert.equal(report.workers[0].db.queries, 21);
  assert.equal(report.workers[0].routes['GET rsc /address/*'].prefetch_hints, 10);
  assert.equal(report.workers[0].routes['GET rsc /address/*'].next_cache.HIT, 20);
  const files = (await readdir(directory)).filter(name => name.endsWith('.cpuprofile'));
  const profile = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'));
  assert.ok(profile.nodes.length > 0); assert.ok(profile.samples.length > 0);
});

test('runtime has no output or resident timer when disabled', async () => {
  const child = spawn(process.execPath, ['--require', runtime, '-e', ''], {
    env: { ...process.env, EXPLORER_METRICS: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0); assert.equal(output, '');
});
