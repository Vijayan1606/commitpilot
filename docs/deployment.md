# Deployment

## Local development (recommended)

Requirements: Node ≥ 22.5, Git, and (optionally) a local open model.

```bash
npm ci
cp .env.example .env.local
cp .env.example .env
# set COMMITPILOT_MCP_TOKEN in both files

npm run dev      # http://127.0.0.1:3000
npm run mcp      # http://127.0.0.1:4319/mcp
```

Both processes bind **127.0.0.1** by default. SQLite lives in `.data/`; repositories must live under `.workspaces/` unless you change `COMMITPILOT_WORKSPACE_ROOT` or the Settings value.

Production mode on the same machine:

```bash
npm run build
npm run start    # binds 127.0.0.1:3000
npm run mcp
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMMITPILOT_WORKSPACE_ROOT` | `./.workspaces` | Only place repositories may live |
| `COMMITPILOT_DATA_DIR` | `./.data` | SQLite, encryption key, backups, temp |
| `COMMITPILOT_DB_PATH` | `<data>/commitpilot.db` | Override the database file |
| `COMMITPILOT_ALLOW_PATCH_APPLY` | `false` | Enables the apply decision after approval |
| `COMMITPILOT_ALLOW_COMMANDS` | `false` | First gate for validation commands |
| `COMMITPILOT_MAX_FILES` | `2000` | Tracked files per scan |
| `COMMITPILOT_MAX_FILE_BYTES` | `262144` | Per-file read cap |
| `COMMITPILOT_MAX_DIFF_BYTES` | `200000` | Diff cap |
| `OPENMODEL_BASE_URL` | — | OpenAI-compatible API root |
| `OPENMODEL_MODEL` | — | Model id |
| `OPENMODEL_API_KEY` | — | Key (or set it in Settings) |
| `OPENMODEL_TIMEOUT_MS` | `120000` | Per-request timeout |
| `OPENMODEL_MAX_RETRIES` | `1` | Retry count for safe failures |
| `COMMITPILOT_MCP_TOKEN` | — | **Required** bearer token for `/mcp` |
| `COMMITPILOT_MCP_HOST` / `PORT` | `127.0.0.1` / `4319` | MCP bind |
| `COMMITPILOT_PUBLIC_URL` | — | Public base URL shown in Settings |
| `COMMITPILOT_APP_SECRET` | generated key file | Key material for credential encryption |
| `COMMITPILOT_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `COMMITPILOT_REPORT_RETENTION_DAYS` | `90` | Used by `npm run cleanup` |
| `COMMITPILOT_BACKUP_RETENTION_DAYS` | `30` | Used by `npm run cleanup` |

## Docker Compose

> Not executed in the build environment (no Docker daemon). The files are provided as a starting point; build them once before recording a demo.

```bash
cp .env.example .env             # set COMMITPILOT_MCP_TOKEN
docker compose build
docker compose up -d
```

- `web` publishes `127.0.0.1:3000` (host loopback only).
- `mcp` publishes `127.0.0.1:4319`, binds `0.0.0.0` inside the container.
- Both mount `./.workspaces` at `/workspace` and a named volume at `/data`.
- The web container runs as the non-root `app` user and has a healthcheck.

The two containers share one SQLite file over the same host volume (WAL mode, busy timeout). This works for a single host, but it is not a substitute for a database server if you add replicas.

## Health and diagnostics

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health` | App + database status, model reachability, tool counters, active jobs. 200 when the database is reachable, 503 otherwise |
| `GET /health` on the MCP process | Process liveness, no repository data |
| `GET /api/settings` | Effective configuration, credential status (masked), MCP URL |

Model reachability is deliberately separate from app health: a model outage is a job failure, not an app outage.

## Reverse proxy / tunnel

If Alan runs in the cloud and CommitPilot runs locally, expose only the MCP port through an authenticated HTTPS tunnel:

1. Terminate TLS at the tunnel/proxy.
2. Keep `Authorization: Bearer` enforcement (it is always on).
3. Set `COMMITPILOT_PUBLIC_URL=https://…` so the Settings page shows the right endpoint.
4. Do not expose port 3000; the UI is single-user and has no login.

## Backup and restore

Back up `.data/` as a unit:

- `commitpilot.db` + WAL/SHM files
- `secret.key` (or `COMMITPILOT_APP_SECRET`)
- `backups/`

Without the key, the encrypted model credential cannot be decrypted; you can re-enter it.

Stop both processes (or run `PRAGMA wal_checkpoint`) before copying for a consistent snapshot.

## Retention and cleanup

```bash
npm run cleanup
```

Deletes reports older than 90 days, backups older than 30 days, and temporary patch files older than a day. Override with the environment variables above. Repositories are never touched.

## Updating

```bash
git pull
npm ci
npm run build
npm run mcp    # restart
npm run start  # restart
```

Migrations are applied automatically on first database access and recorded in `schema_migrations`. Interrupted jobs are marked failed at startup.

## Public hosting — not supported as-is

Do not put this build on the public internet with access to a host filesystem. A hosted version needs:

- authentication and per-user repository isolation;
- repository access through a provider connection or an isolated workspace per user;
- object storage for reports and a shared database;
- TLS and short-lived MCP tokens;
- sandboxed command execution;
- quotas.

The architecture keeps these boundaries in `src/server` so they can be replaced, but none of them are implemented.