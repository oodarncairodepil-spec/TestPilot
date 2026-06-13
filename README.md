# Self-Hosted Playwright Test Runner

Full-stack platform for uploading/pasting Playwright TypeScript tests, executing runs in isolated Docker containers, streaming logs over WebSockets, and browsing artifacts/results.

## Stack

- Frontend: Next.js + React + TypeScript + Monaco Editor
- Backend: Node.js + Express + TypeScript + SQLite (`better-sqlite3`)
- Runner: Playwright Test in `mcr.microsoft.com/playwright:v1.55.0-jammy`
- Deployment: Docker Compose (single-node)

## Features Implemented

- Dashboard stats (`total`, `passed`, `failed`, `running`)
- Scripts CRUD with disk-backed storage in `/scripts`
- Run queue with statuses: `queued`, `running`, `passed`, `failed`, `timeout`
- Isolated workspace per run in `/workspaces/<run-id>`
- Artifact capture in `/artifacts/<run-id>`:
  - `stdout.txt`
  - `stderr.txt`
  - `report.json`
  - `test-results/` (screenshots/videos/traces from Playwright)
  - `metadata.json`
- Live log streaming via WebSocket (`/ws`)
- Results and artifact download APIs
- Health endpoint + graceful shutdown
- ESLint + Prettier + TypeScript in frontend/backend

## API Endpoints

- `POST /api/scripts`
- `PUT /api/scripts/:id`
- `DELETE /api/scripts/:id`
- `GET /api/scripts`
- `POST /api/run`
- `GET /api/runs`
- `GET /api/run/:id`
- `GET /api/artifacts/:id`
- `GET /api/artifacts/:id/file/:filePath`
- `GET /api/logs/:id`
- `GET /healthz`

## Default Test Seed

Seed script provided in [`scripts/skorpintar-login.spec.ts`](./scripts/skorpintar-login.spec.ts) for:

- URL: `https://beta.skorpintar.com/login`
- Username: `ligar@siapkpr.com`
- Password: `abc123`

## Run with Docker Compose

```bash
cd /home/xghrtkl/playwright-runner-platform
docker compose build
docker compose up -d
```

Access:

- Frontend: `http://<tailscale-ip>:3000`
- Backend API: `http://<tailscale-ip>:4000`

Environment is already bound to `0.0.0.0` in Compose for Tailscale access.

## Security Model

- Runs executed in disposable Docker containers
- CPU and memory limits set (`--cpus`, `--memory`, `--pids-limit`)
- Dropped Linux capabilities (`--cap-drop=ALL`)
- `no-new-privileges` enabled
- Max runtime enforced: 10 minutes
- Host filesystem exposure restricted to run workspace and artifacts mounts

## Notes

- `consoleLogs`, `networkFailures`, and `finalUrl` are present in result JSON and metadata; by default these fields are empty unless tests explicitly emit/record them.
- SQLite path: `./data/app.db` (easy migration path to PostgreSQL by replacing repository layer).
- Queue is currently in-process (single-user safe); Redis can be introduced for distributed workers later.

## Future Extensibility Hooks

Current architecture keeps script management, run queue, and execution isolated so you can add:

- AI-generated tests (OpenAI/OpenRouter/DeepSeek)
- PRD ingestion pipelines
- autonomous website exploration agents
- Jira bug ticket creation
- CI/PR webhooks and reporting integrations

