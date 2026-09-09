# Explorer CPU measurement

Tools for step 1 of the action plan. They require Node 24 or 25 and access to
the local Docker socket when measuring containers. No npm dependencies are added.

Frontend instrumentation is **disabled by default**. It does not change responses,
queries, caching, or retry policies. When enabled, it aggregates metrics in memory
by a bounded set of route groups and writes one JSON line per worker and interval.
It does not log addresses, hashes, query parameters, IPs, or full headers.

## 1. Enable frontend measurement

From the repository root, build the image containing the new files:

```bash
docker compose build frontend
EXPLORER_METRICS=1 docker compose up -d --no-deps frontend
```

To preserve this setting across deployments, add `EXPLORER_METRICS=1` to the
server's `.env`. Supported variables:

| Variable | Default | Purpose |
|---|---|---|
| `EXPLORER_METRICS` | `0` | Set to `1` to enable metrics and signal-triggered profiling |
| `EXPLORER_METRICS_INTERVAL_MS` | `10000` | Reporting window per worker, from 1,000 to 60,000 ms |
| `EXPLORER_CPU_PROFILE_MS` | `60000` | Profile duration per signal, from 1,000 to 300,000 ms |

The four workers emit `explorer_metrics`: cumulative and per-window process CPU,
completed, aborted, and active requests, HTTP statuses, RSS/heap, GC duration,
and p50/p95 latency by method/type/route. Responses are counted when they finish,
not when they start. An interrupted connection is not counted as a completed
response. All requests reaching Node are counted, including proxy refreshes.

`cpu_ms_per_completed` is the entire process's CPU divided by completed responses
in that window. It is not CPU attributed to a specific route: concurrent requests,
GC, and background tasks share the process. Use sufficiently long windows; do not
average worker ratios or percentiles. The scripts sum CPU and counters before
calculating ratios. Windows without completed responses return `null`.

### Additional diagnostics (schema 2)

With `EXPLORER_METRICS=1`, each worker also reports:

- `db`: query count, summed duration and maximum duration from Prisma query events.
  Durations are provider-reported elapsed milliseconds, not CPU, pool wait time or
  end-to-end Prisma operation time. Parallel queries overlap. Counters are per
  process, not per route. Never subtract them from latency to estimate rendering.
  The diagnostic listener publishes no SQL or parameters.
- `event_loop`: active/idle time, utilization and p95/max scheduling delay, sampled
  at 20 ms resolution. Utilization is not CPU usage; synchronous I/O also keeps
  the loop active. The report aggregates active/idle time and maximum delay,
  without averaging window percentiles.
- Per-route `prefetch_hints`: completed requests declaring Next router/segment
  prefetch or Purpose/Sec-Purpose prefetch. These client-controlled hints do not
  prove intent. Requests without hints may still be prefetches.
- Per-route `next_cache`: completed responses with X-Nextjs-Cache equal to HIT,
  MISS, STALE or REVALIDATED. Other values become UNREPORTED, which is not a miss.
  This does not measure the Next Data Cache or nginx/CDN caches.

Event emission and delay sampling add overhead: compare runs with identical
instrumentation settings. Old logs remain supported; missing DB/event-loop metrics
become null. Coverage counters distinguish old windows from measured zero values.

After deploying this source revision through your normal workflow, rebuild and
recreate the frontend using the commands above. This briefly interrupts service
and changes worker PIDs. Confirm `"schema":2` in fresh logs, collect five minutes
without profiling, then capture a separate CPU profile using the procedure below.
No new ports or public endpoints are required.

Disable instrumentation by setting `EXPLORER_METRICS=0` and recreating only the
frontend. Outside PM2, the equivalent command is:

```bash
EXPLORER_METRICS=1 node --require ./frontend/diagnostics/runtime.cjs PATH_TO_SERVER_JS
```

## 2. Record nginx upstream information

In the Hestia companion configuration that declares `log_format neurai_cache`,
**replace** that declaration with the following. Do not add another declaration
with the same name:

```nginx
log_format neurai_cache '$remote_addr - $remote_user [$time_local] "$request" '
                        '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                        'cache=$upstream_cache_status rt=$request_time rsc=$http_rsc '
                        'upstream_addr="$upstream_addr" upstream_status="$upstream_status" '
                        'upstream_rt="$upstream_response_time"';
```

The local `docs/nginx-neurai-explorer.conf` file already contains this change.
`docs/` is ignored by Git: when transferring changes to the server, copy that
file explicitly or edit the declaration using this versioned document.
Adding log fields does not require changing cache keys or purging the cache.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Analyze a log window using ISO timestamps that include a time zone:

```bash
node tools/cpu/nginx-report.mjs --log access.log \
  --since 2026-09-08T13:00:00Z --until 2026-09-08T13:05:00Z > nginx-report.json
```

The report groups HTML/API/RSC/static requests and includes `BYPASS`, bytes,
errors, cache statuses, and total/upstream timing percentiles. It can read the
previous format; upstream data remains absent when those fields are missing.
It reports how many lines could not be parsed. RSC classification uses the logged
header, not just the presence of `_rsc` in the URL. The nginx log does not provide
an exact count of background refreshes: compare it with the Node counters.

## 3. Collect a real traffic window over SSH without generating load

Run these commands **inside the SSH session**, from the server's repository.
After deploying instrumentation, wait at least one reporting interval. Adjust
container names if they differ from those in the Compose configuration.

```bash
mkdir -p tools/cpu/results
node tools/cpu/measure.mjs --mode observe --seconds 300 \
  --containers neurai-explorer-frontend,neurai-explorer-postgres \
  --label remote-normal-traffic --out tools/cpu/results/remote.json
docker logs --since 10m neurai-explorer-frontend > tools/cpu/results/remote-node.log 2>&1
```

`observe` only reads Docker counters; it makes no HTTP requests to the explorer.
The JSON records UTC start/end times, container identity and image, and samples
of cumulative CPU and memory. If a container restarts or a sample fails, its CPU
result is marked invalid rather than reported as zero.

Use `start`/`end` from `remote.json` as the boundaries for the Node and nginx reports:

```bash
node tools/cpu/metrics-report.mjs --log tools/cpu/results/remote-node.log \
  --since START_TIMESTAMP --until END_TIMESTAMP > tools/cpu/results/remote-node-report.json
node tools/cpu/nginx-report.mjs \
  --log /var/log/apache2/domains/explorer.neurai.org.log \
  --since START_TIMESTAMP --until END_TIMESTAMP > tools/cpu/results/remote-nginx-report.json
```

The Node report excludes windows that cross the boundaries and shows how many
were discarded; it does not invent proportional request counts. Effective
boundaries per worker may differ slightly from the Docker window. PostgreSQL CPU
includes the syncer and any other clients. Do not automatically divide that CPU
by a Node counter from a different window or attribute all PostgreSQL work to
the frontend.

If Node is not installed on the server, passive collection can run through Docker:

```bash
docker run --rm --network none \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD:/workspace" -w /workspace node:25-alpine \
  node tools/cpu/measure.mjs --mode observe --seconds 300 \
  --containers neurai-explorer-frontend,neurai-explorer-postgres \
  --out tools/cpu/results/remote.json --label remote-normal-traffic
```

Do not reuse an existing output filename: the tool refuses to overwrite it.
Download the JSON files and logs with `scp` when finished. Results are stored in
`tools/cpu/results/`, which is ignored by Git.

## 4. Run a fixed workload locally or in staging

`workload.local.json` contains 15 cases drawn from the local database: HTML,
RSC requests, listings, addresses, API responses, address history through page 20,
and statistics. Each round executes every entry exactly once, with configurable
maximum concurrency, no retries, and no redirect following. Responses are read
fully without retaining their bodies in memory; status and content type are checked.

Check the IDs before using a different database. The largest block in this sample
has only three transactions: **add a genuinely large block** to cover that scenario.
The sample RSC requests send `RSC: 1` without browser router state. They measure
that response type but do not reproduce complete browser navigation. To reproduce
specific navigations, also copy the `Next-Router-State-Tree` and prefetch headers
from requests captured in that staging environment, and save a new fixed workload.

```bash
node tools/cpu/measure.mjs --mode load --base http://127.0.0.1:3433 \
  --workload tools/cpu/workload.local.json --rounds 40 --concurrency 4 --warmup 2 \
  --containers neurai-cpu-baseline,neurai-explorer-postgres \
  --out tools/cpu/results/warm-a.json --label local-warm-no-proxy
```

Replace the port and container names with those of staging. Remote URLs require
an explicit `--allow-remote`; load mode must not target the public server.
Do not bypass normal API limits to obtain artificially favorable results: 429
responses count as errors in the sample workload. If they occur, reduce the load
or space out runs, and record the scenario. Do not spoof IPs to bypass limits.

The report preserves the workload's SHA-256 hash and contents, concurrency,
rounds, warmup, statuses, errors, bytes, and percentiles per case. Latency includes
reading the body or the time until failure; bytes cover the HTTP response body,
excluding headers. `Accept-Encoding: identity` is requested by default.
Docker metrics cover a nearby window that includes a small sampling margin;
record `sample_start`/`sample_end`, especially for short tests.

Compare multiple runs with the same workload, image, and resources. Prepare
separate tests against the origin and through nginx. For a cold cache, use a
disposable cache instance in staging; do not purge production or call a database
"cold" when its buffers are already warm. `--warmup 0` only skips the load
generator's warmup. Also collect a passive idle window before generating load.

Docker memory includes cache and is not equivalent to Node RSS. Reported peaks
are **sampled** peaks; they do not guarantee every spike was captured. A test
lasting a few seconds validates functionality but does not replace a sustained
window for studying GC, memory growth, or saturation. Do not combine profiled
and unprofiled sessions as though they had the same overhead.

## 5. Capture CPU profiles without opening an inspector port

With metrics enabled, obtain the actual worker PIDs and send `SIGUSR2` to the
selected workers **inside the container**:

```bash
docker top neurai-explorer-frontend
docker logs --tail 20 neurai-explorer-frontend
docker exec neurai-explorer-frontend kill -USR2 PID_FROM_METRICS_JSON
```

Use the `pid` from the metrics JSON. Do not assume the PID shown by `docker top`
(in the host namespace) is the same. Do not send the signal to PM2 or a process
without the hook enabled. A second signal during capture does not start another
profiling session.

Each selected worker emits `explorer_profile_start` and, after the configured
duration, `explorer_profile_saved`. Collect the files before removing the container:

```bash
docker cp neurai-explorer-frontend:/tmp/explorer-cpu tools/cpu/results/profiles
```

Open `.cpuprofile` files in DevTools or a compatible viewer and examine stacks
and self time for React/RSC, JSON serialization, Intl, GC, and the runtime.
Native Prisma code, PostgreSQL, and compression may require additional
measurements; the V8 profile alone does not account for all container CPU.

API references: [Node 25 diagnostics_channel](https://nodejs.org/docs/latest-v25.x/api/diagnostics_channel.html),
[Node CPU profiler](https://nodejs.org/api/inspector.html#cpu-profiler), and
[nginx logging](https://nginx.org/en/docs/http/ngx_http_log_module.html).

## Validate the tools

```bash
node --test tools/cpu/diagnostics.test.mjs
```

The tests use local servers and cover complete streams, errors, timeouts,
redirects, BYPASS/RSC classification, counters under concurrency and interrupted
connections, absence of instrumentation when disabled, and generation of an
actual CPU profile. The Docker build also validates startup through PM2.
