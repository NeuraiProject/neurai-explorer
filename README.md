# Neurai Explorer

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2024-DEA584?style=flat-square&logo=rust)](https://www.rust-lang.org/)
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
| Syncer Runtime | Rust | 2024 Edition |
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
- **Schema Management**: Controlled via Prisma migrations
- **Indexed Data**:
  - Block data (height, hash, timestamp, transaction count)
  - Transaction records (txid, block reference, inputs/outputs)
  - Address ledgers and balance tracking

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
RPC_THREADS=256
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

### Resource Limits

Default Docker resource configuration:

| Service | Memory Limit | CPU Limit |
|---------|--------------|-----------|
| Frontend | 1GB | - |
| Syncer | 2GB | - |
| PostgreSQL | 2GB | - |
| Node | 4GB | - |

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
│   ├── app/                  # App Router pages
│   ├── components/           # React components
│   ├── lib/                  # Utilities & helpers
│   └── prisma/               # Database schema
├── syncer/                   # Rust syncer service
│   ├── src/
│   │   ├── main.rs           # Entry point
│   │   ├── rpc/              # RPC client
│   │   └── db/               # Database operations
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
