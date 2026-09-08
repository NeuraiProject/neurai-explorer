# CPU baseline — local environment

Date: 2026-09-08. Step 1 of the action plan.

**Instrumentation implemented and validated against real local data.** Collecting
the remote server's window to identify the cost under its real traffic is still
pending. These results neither reproduce nor explain the production incident on
their own.

## Environment and method

- Image built from the current code, revision base `217b7fa`, with the added
  instrumentation and without the optimizations from later steps.
- Test image: `neurai-explorer-frontend:cpu-measurement`.
- Recorded ID: `sha256:5bbd325082cfc39cb8c6b075b63c2b9fbfe2db0caac2eb09e0e6c7e52df997d4`.
- Separate frontend `neurai-cpu-baseline`, exposed only on `127.0.0.1:3433`,
  four PM2 workers, Node 25.9.0. The original local frontend kept running.
- Local PostgreSQL shared with the syncer. Synchronization was not paused, no
  data was modified, and no caches were purged. Its CPU is aggregate usage.
- Generator on Node 24.15.0, maximum concurrency four, responses requested
  without compression and without retries. Node metrics every second during
  validation.
- Fixed mix of 15 cases in [workload.local.json](workload.local.json).
  SHA-256: `68890571ae1408b2227e8d57fac5233cddb3d1cce45a73b65fdc5d01ad92e927`.

The mix includes HTML pages, RSC for listings/addresses/statistics, and API.
The comparable runs executed two warm-up rounds and 40 measurements:
600 requests per run, exactly 40 per case.

## Results without profiler and without nginx/CDN

| Metric | Run A | Run B |
|---|---:|---:|
| Requests measured / complete HTTP responses | 600 / 600 | 600 / 600 |
| HTTP, transport, or content-type errors | 0 | 0 |
| p50 latency | 3.82 ms | 3.82 ms |
| p95 latency | 28.58 ms | 29.08 ms |
| Load duration | 1.240 s | 1.255 s |
| Cumulative frontend container CPU | 5,910.65 ms | 6,074.51 ms |
| Frontend CPU / response | 9.85 ms | 10.12 ms |
| PostgreSQL CPU / response, syncer not isolated | 0.97 ms | 0.93 ms |
| Body bytes received | 28,001,640 | 28,001,560 |

CPU can exceed wall-clock time because processes and threads run concurrently.
The Docker counters cover a slightly wider window than the requests, saved in
each JSON. These runs are short: they serve as a first reproducible baseline,
not as a basis for concluding long-term memory/GC stability or maximum
sustainable capacity.

Among the cases in this mix, `address-rsc-1` had the highest p95 in both runs,
around 37 ms. It was followed by the other address history requests, the
difficulty history, and the statistics. **Latency does not equal that route's
CPU**; it has to be cross-checked against profiles and queries.

## Counter and profile verification

Before the additional nginx test, the four workers' logs summed to exactly
**2,613 complete responses and zero aborted**: three queries to prepare the
sample, 150 initial requests, two runs of 630 including warm-up, and 1,200
requests from the profiler session.

A ten-second profile was captured per worker via `SIGUSR2`, without opening an
inspector port. All four contain valid samples. The load occupied only part of
that window, so the idle state predominates.

The active samples show the React/RSC runtime, Prisma's `parseEngineResponse`,
GC, and the address history rendering callback. The latter accumulates roughly
861 ms of self sample time across the four profiles. Its location in the bundle
was verified: it prepares imports/assets, formats dates with `toLocaleString`,
and builds the rows. This points to work worth measuring when implementing steps
4 and 11; it **does not attribute those 861 ms exclusively to date formatting**,
nor does it represent all native CPU.

The profiler session's results are stored separately and are not used to claim
improvements against runs A/B.

On a disposable nginx instance, four requests produced `MISS`, `HIT`, `STALE`,
and `BYPASS`. Node recorded exactly three origin calls: the initial load, the
background refresh, and the RSC one. The latter was also verified to preserve
`text/x-component`. The companion file passed `nginx -t` on nginx:alpine.

The temporary test frontend and nginx instances were removed after collecting
the evidence. The diagnostic image remains available locally.

## Coverage and limits

- The data comes from the local DB, with sample height 1,772,036.
- The largest block among the last 100 sampled had three transactions. The
  scenario still needs to be extended with a genuinely large block.
- Pagination reached page 20 of an address whose history had 17,385 pages. No
  queries were issued against its last page, nor any bulk requests.
- The test RSC requests use the `RSC: 1` header, without router state captured
  from a browser. Full navigation requires separate validation with real traffic.
- Runs A/B go straight to Node. They do not test nginx/Cloudflare cache hit
  rates or their behavior under the remote server's volume.
- The additional cost of instrumenting versus disabling it is not quantified.
  Keep the same configuration when comparing future changes.

## Evidence files

The large files stay in `tools/cpu/results/`, ignored by Git:

- `idle.json`: five seconds of sampling without generator load.
- `local-first.json`: first run, without explicit warm-up; this does not mean
  PostgreSQL had cold buffers.
- `local-warm-a.json` and `local-warm-b.json`: comparable baseline.
- `local-profiled.json` and `profiles/*.cpuprofile`: profiler session.
- `local-node.log` and `local-node-report.json`: per-worker counters.
- `nginx-test.log` and `nginx-test-report.json`: cache state test.

See [procedure and SSH commands](README.md) to repeat the measurement and collect
the remote server's traffic. Record a sustained window and the same per-route
information there before prioritizing optimizations based on these local numbers.
