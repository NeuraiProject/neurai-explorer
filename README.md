# Neurai Explorer

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

A blockchain explorer for the Neurai network, engineered for efficiency and scalability. It combines a Rust backend for high-throughput block synchronization with a Next.js frontend for the user interface.

### Technical Overview

*   **Syncer Backend**: Implemented in **Rust** using **Tokio** for asynchronous event processing. Handles block indexing with reduced memory overhead.
*   **Frontend Architecture**: Built on **Next.js 16** (App Router) and **React 19**, leveraging Server Components for optimized rendering.
*   **Analytics**: Data visualization for network statistics, including difficulty and hashrate, utilizing **Recharts**.
*   **Asset Management**: Native indexing and display of Neurai Assets (Tokens), including metadata and transfer ledgers.
*   **User Interface**: Responsive layout constructed with **Tailwind CSS**, including system-aware theme support.
*   **Data Persistence**: **PostgreSQL** database managed via **SQLx** for the syncer and **Prisma** for frontend queries.

![neuria explorer home](neurai-explorer-home.png)

---

## Table of Contents

1. [Architecture Overview](#-architecture-overview)
2. [Tech Stack](#-tech-stack)
3. [Services](#-services)
4. [Getting Started](#-getting-started)
5. [Configuration](#%EF%B8%8F-configuration)
6. [Development](#-development)
7. [Project Structure](#-project-structure)
8. [Contributing](#-contributing)
9. [License](#-license)

---

## Architecture Overview

![neuria explorer home](neurai_architecture.png)

The explorer follows a microservices architecture with four main components communicating through Docker's internal network.

---

## Tech Stack

### Core

| Component | Technology | Version |
|-----------|------------|---------|
| Frontend Framework | Next.js (App Router) | 16.x |
| UI Library | React | 19.x |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| State Management | TanStack Query | Latest |

### Backend & Data

| Component | Technology | Version |
|-----------|------------|---------|
| Syncer Runtime | Rust | 2021 Edition (rust 1.92) |
| Async Runtime | Tokio | Latest |
| Database Driver | SQLx | Latest |
| Database | PostgreSQL | 18.1 |
| ORM (Frontend) | Prisma | Latest |

### Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| Containerization | Docker Compose | Service orchestration |
| Blockchain Node | Neurai Core | Network connectivity |
| Node Image | `neuraiproject/neurai-node` | Published Neurai node image (Docker Hub) |

---

## Services

### Frontend (`neurai-frontend`)

Web interface for blockchain data visualization and interaction.

- **Framework**: Next.js 16 (App Directory structure)
- **Features**:
  - Block exploration with pagination support
  - Transaction inspection and search functionality
  - Network statistics dashboard
  - Asynchronous state management via React Query
- **UI Components**:
  - Icons provided by Lucide React & React Icons
  - Data visualization using Recharts
  - Conditional class utility via clsx

### Syncer (`neurai-syncer`)

Rust-based service responsible for blockchain synchronization and indexing.

- **Architecture**: Asynchronous execution using the Tokio runtime
- **Database**: Direct PostgreSQL interaction via SQLx with compile-time query verification
- **Performance**:
  - Memory usage: ~500MB (efficient resource management)
  - Zero-copy deserialization implemented where applicable
  - Database connection pooling
- **Communication**: JSON-RPC interface to the Neurai Node

### Database (`neurai-postgres`)

PostgreSQL instance for indexed blockchain data persistence.

- **Engine**: PostgreSQL 18.1 (Alpine Linux variant)
- **Schema Management**: SQL migrations in `syncer/migrations/`, applied by
  the syncer at startup (the frontend's Prisma schema only mirrors them)
- **Indexed Data**:
  - Block headers (height, hash, timestamp, transaction count, txids)
  - Transactions (decoded JSON, raw bytes, position in block)
  - Per-transaction history of what each address received/spent, in XNA and
    in assets; address and asset ledgers are sums of that history

### Node (`neurai-node`)

Neurai blockchain daemon instance.

- **Image**: [neuraiproject/neurai-node](https://hub.docker.com/r/neuraiproject/neurai-node) `v1.0.6`, pulled from Docker Hub (no local build)
- **Source**: [NeuraiProject/Neurai](https://github.com/NeuraiProject/Neurai) 1.0.6 release
- **Configuration**: full indexes (`txindex`, `assetindex`, `addressindex`, `timestampindex`, `spentindex`), REST enabled, wallet disabled, no inbound P2P
- **Ports**:
  - `19001`: JSON-RPC interface, reachable only inside the Compose network

---

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) >= 24.0
- [Docker Compose](https://docs.docker.com/compose/) >= 2.20
- 8GB+ RAM recommended
- 50GB+ disk space for blockchain data

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/neurai-explorer.git
cd neurai-explorer

# Optional: review credentials, ports and node settings before the first start
cp .env.example .env

# Build and start all services (the node image is pulled from Docker Hub)
docker compose up --build -d

# View logs
docker compose logs -f
```

### Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Explorer UI | http://localhost:3000 | Web interface |
| PostgreSQL | localhost:5432 | Database (internal) |
| Node RPC | node:19001 | Blockchain RPC (internal, Compose network only) |

---

## Configuration

### Environment Variables

All variables that `docker-compose.yml` reads from `.env` are listed with their
defaults and comments in [`.env.example`](.env.example): node image tag, shared
RPC credentials and capacity, node database cache, PostgreSQL credentials, and
the frontend host port. Copy it to `.env` and edit it before the first start;
`.env` is ignored by git.

The sections below describe the variables each service receives internally.

#### Syncer Configuration

```env
# RPC Connection
RPC_HOST=node
RPC_PORT=19001
RPC_USER=neuraiuser
RPC_PASS=neuraipassword

# Database
DATABASE_URL=postgres://user:pass@postgres:5432/neurai

# Logging
RUST_LOG=info,sqlx=warn,reqwest=warn

# Fetch blocks/previous transactions through the node's REST interface (default 1)
RPC_USE_REST=1

# Attempts per node request for transient failures (transport, HTTP 5xx/429)
# and base backoff between attempts (doubles, with jitter, honours Retry-After)
RPC_RETRIES=3
RPC_RETRY_DELAY_MS=200
```

At startup the syncer waits for the node to answer RPC (it logs a
`Node not ready, retrying` line every few seconds while the node loads its
indexes or reindexes), so it can be started together with the node.

Sync tuning lives in `syncer/config.json` (rebuild the image after changing it):

| Option | Default | Meaning |
|--------|---------|---------|
| `batchSize` | 250 | Blocks fetched and written per database transaction |
| `blockFetchConcurrency` | 16 | Concurrent block requests to the node |
| `inputFetchConcurrency` | 32 | Concurrent previous-transaction requests |
| `prefetchBatches` | 2 | Batches fetched ahead while the previous one is written |
| `asyncCommit` | true | Commit batches with `synchronous_commit=off` (a crash only re-syncs the last batches; the database never ends up inconsistent) |
| `supplyInterval` | 600000 | ms between `gettxoutsetinfo` calls (scans the node's whole UTXO set) |
| `bulkModeThreshold` | 20000 | Blocks behind the tip from which the syncer runs in *bulk mode* (see below); 0 disables |
| `indexBuildMem` | 512MB | `maintenance_work_mem` used to rebuild the deferred indexes |

During the initial sync the log prints a `Sync progress` line every 10 s with
the current height, blocks/s, the share of time spent writing to PostgreSQL
(`db_pct`) and an ETA.

**Bulk mode.** While the database is more than `bulkModeThreshold` blocks
behind the tip, the syncer drops the secondary indexes whose keys are random
(`idx_txaddr_address_time`, `idx_txaa_*_height`, `idx_asset_events_name`,
`idx_addr_balance`, `idx_addr_asset_bal`) and pauses autovacuum on the big
tables — maintaining them insert by insert is most of the write cost of the
initial load and nothing queries them yet. Primary keys and the `time` /
`block_height` indexes stay. When it gets within the threshold it rebuilds
the indexes in one go (a few minutes at most), re-enables autovacuum and
analyzes the tables. What was dropped is recorded in `sync_state.bulk_mode`,
so a restart at any point resumes correctly. While bulk mode is on,
`/api/status` reports `initialSync: true` and the address, rich-list and asset
holder pages are slow (sequential scans); the rest of the explorer works.

##### Database layout (schema v4)

- Amounts are parsed exactly from the node's JSON (no `f64` step), stored as
  `NUMERIC` with 8 decimals, and written back into `raw_data` and the API as
  **decimal strings** (`"21000000000.12345678"`), so JavaScript consumers keep
  satoshi precision. `transactions.total_output` and `transactions.fee` are
  computed exactly by the syncer.
- `blocks.raw_data` holds the block header with `tx` as a list of txids; the
  decoded transactions are in `transactions.raw_data` (ordered by `tx_index`),
  and the serialized bytes in `transactions.raw_hex`.
- `tx_addresses.received/sent` and `tx_address_assets.delta` record what each
  address moved in each transaction, so `addresses`/`address_assets` balances
  are sums of the history and `addresses.tx_count` counts distinct
  transactions.

- `asset_events` keeps every issuance/reissuance output; the `assets` row is
  the fold of them.

A syncer whose schema version differs from the one stored in the database
refuses to start; set `RESYNC_ON_SCHEMA_CHANGE=1` for one start to wipe the
indexed data and resync from genesis.

##### Reorgs and manual rollback

Because balances are sums of the history rows, a chain reorg is undone
exactly: the syncer subtracts the history of the orphaned blocks, deletes
them, rebuilds the affected assets from their remaining events and resumes
from the fork. The same operation is available by hand (for example after
restoring an older node datadir):

```bash
docker compose run --rm syncer neurai-syncer --rollback 1234567   # undo blocks >= 1234567
docker compose up -d syncer                                        # resync from there
```

#### Frontend Configuration

```env
# Database (Prisma)
DATABASE_URL=postgres://user:pass@postgres:5432/neurai

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

#### Node Configuration

The node runs the published `neuraiproject/neurai-node` image. Its
`neurai.conf` is generated by the image entrypoint from the `NEURAI_*`
environment variables set in `docker-compose.yml`, and only on the first start
of an empty `node-data` volume. The values that can be overridden from `.env`
(see `.env.example`) are:

```env
NEURAI_IMAGE_TAG=v1.0.6   # Docker Hub tag to run
RPC_USER=neuraiuser       # shared with syncer and frontend
RPC_PASS=neuraipassword
RPC_WORKQUEUE=1024
RPC_THREADS=64            # HTTP worker threads shared by RPC and REST
NODE_DB_CACHE=128         # MB; raise it for a faster initial sync
```

To change an existing node, edit `/data/neurai.conf` inside the `node-data`
volume and restart the `node` service:

```bash
docker compose exec node sh -c 'cat /data/neurai.conf'
docker compose restart node
```

Enabling or disabling indexes on an already synced node requires reindexing
(`docker compose run --rm node -reindex`).

##### Migrating from the locally built node

Earlier versions built the node from `node/` and stored data in
`/data/node` inside the `node-data` volume. The published image stores data in
`/data` and runs as an unprivileged `neurai` user. To keep the existing chain
data, move it and fix ownership once, with the stack stopped:

```bash
docker compose down
docker run --rm --entrypoint sh -v neurai-explorer_node-data:/data \
  neuraiproject/neurai-node:v1.0.6 -c \
  'mv /data/node/* /data/ && rmdir /data/node && chown -R neurai:neurai /data'
docker compose up -d
```

Otherwise remove the volume (`docker volume rm neurai-explorer_node-data`) and
let the node sync from scratch.

##### Upgrading the explorer database

The layout of the indexed data has a version (`sync_state.schema_version`,
currently 4). When a new syncer image needs a different layout, it does not
try to convert the existing rows: it stops at startup with a message asking
for a resync. Rebuild the images and resync in one go:

```bash
git pull
docker compose build syncer frontend
docker compose stop syncer frontend
RESYNC_ON_SCHEMA_CHANGE=1 docker compose up -d syncer   # wipes the indexed data, syncs from genesis
docker compose up -d frontend
docker compose logs -f syncer                          # "Sync progress" lines show blocks/s and ETA
```

`RESYNC_ON_SCHEMA_CHANGE=1` is only honoured when the stored version differs,
and the syncer warns at every start while it is set, so it can also live in
`.env`; put it back to `0` once the resync has started. `network_stats`
(prices, peers) is kept; everything else is rebuilt from the node.

Removing the database volume instead (`docker compose down`,
`docker volume rm neurai-explorer_pg-data`, `docker compose up -d`) has the
same effect and also resets PostgreSQL itself.

The node is not touched by an explorer upgrade; only the explorer tables are
re-read from it. With the batched syncer and REST fetching the full resync of
mainnet is a matter of an hour or so, mostly bounded by the node.

### Resource Limits

Default Docker resource configuration (`docker-compose.yml`):

| Service | Memory Limit | Memory Reservation |
|---------|--------------|--------------------|
| Syncer | 12GB | 2GB |
| Frontend | - | - |
| PostgreSQL | - (tuned via `PG_SHARED_BUFFERS` / `PG_EFFECTIVE_CACHE_SIZE`) | - |
| Node | - (`NODE_DB_CACHE` sets its database cache) | - |

The syncer itself needs a few hundred MB during the initial sync (a couple of
batches in flight plus the previous-outputs cache); the limit is generous.

---

## Development

### Stopping Services

```bash
docker compose down
```

### Rebuilding a Single Service

```bash
docker compose up --build -d <service-name>
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f neurai-syncer
```

### Database Access

```bash
docker compose exec neurai-postgres psql -U neuraiuser -d neurai
```

---

## Project Structure

```
neurai-explorer/
├── frontend/                 # Next.js application
│   ├── src/app/              # App Router pages and /api routes
│   ├── src/components/       # React components
│   ├── src/lib/              # API client, exact-amount helpers (utils.ts)
│   ├── src/lib/services/     # DB queries shared by pages and API routes
│   ├── src/types/            # Shared TypeScript types (amounts are strings)
│   └── prisma/               # Prisma schema (mirrors the syncer's migrations)
├── syncer/                   # Rust syncer service
│   ├── migrations/           # SQL migrations (applied at startup)
│   ├── src/
│   │   ├── main.rs           # Entry point, --rollback command
│   │   ├── rpc/              # RPC/REST client, NodeClient trait
│   │   ├── sync/             # Engine (batches, reorgs), writer, rollback, stats
│   │   ├── db/               # Pool, schema guard, repositories
│   │   └── types/            # Node JSON types, Amount
│   └── Cargo.toml
├── docker-compose.yml        # Service orchestration (node pulled from Docker Hub)
├── .env.example              # Configurable variables with defaults
└── README.md
```

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
