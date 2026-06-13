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


## GitHub Auto Deploy (Self-Hosted Runner)

This repo includes:

- `.github/workflows/auto-deploy.yml`
- `scripts/deploy.sh`

How it works:

1. On push to `main`, GitHub Actions runs on a self-hosted runner with labels:
   - `self-hosted`, `linux`, `x64`, `testpilot`
2. The job executes `scripts/deploy.sh` on the host machine.
3. Script pulls latest `main` and recreates `frontend` and `backend` containers.

Required host setup:

1. Install and register a self-hosted GitHub Actions runner on your server.
2. Add runner label `testpilot`.
3. Ensure deployed repo path is `/home/xghrtkl/TestPilot` (or update `APP_DIR` in workflow).
4. Ensure runner user can run Docker commands (`docker compose ...`).

Manual deploy option:

- GitHub Actions -> `Auto Deploy` -> `Run workflow` -> choose branch input.

### Safer Deploy Options

The deploy script supports two modes via `DEPLOY_MODE`:

- `build` (default): builds local Dockerfiles (`docker compose build ...`)
- `pull`: pulls registry images (`docker compose pull ...`)

Health checks and rollback are enabled through env vars in workflow:

- `HEALTHCHECK_URLS`: comma-separated URLs to verify after deploy
- `HEALTHCHECK_RETRIES`: retry attempts per URL
- `HEALTHCHECK_INTERVAL_SEC`: delay between retries
- `ROLLBACK_ON_FAILURE`: `true|false`

Rollback behavior:

1. Script records the pre-deploy commit.
2. If health checks fail, script runs `git reset --hard <previous-commit>`.
3. It redeploys and re-runs health checks.

To use registry images, set in `.github/workflows/auto-deploy.yml`:

- `DEPLOY_MODE: pull`
- `DEPLOY_SERVICES` to your registry-backed service names.
