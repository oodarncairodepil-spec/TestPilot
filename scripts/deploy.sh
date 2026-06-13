#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/TestPilot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_MODE="${DEPLOY_MODE:-build}" # build | pull
DEPLOY_SERVICES="${DEPLOY_SERVICES:-frontend backend}"
HEALTHCHECK_URLS="${HEALTHCHECK_URLS:-http://127.0.0.1:4000/healthz}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-20}"
HEALTHCHECK_INTERVAL_SEC="${HEALTHCHECK_INTERVAL_SEC:-3}"
ROLLBACK_ON_FAILURE="${ROLLBACK_ON_FAILURE:-true}"

DEPLOY_BRANCH="${DEPLOY_BRANCH//$'\r'/}"
DEPLOY_BRANCH="${DEPLOY_BRANCH//$'\n'/}"
DEPLOY_BRANCH="${DEPLOY_BRANCH%% *}"

if [[ -z "${DEPLOY_BRANCH}" ]]; then
  echo "DEPLOY_BRANCH is empty after normalization" >&2
  exit 1
fi

if [[ ! -d "${APP_DIR}" ]]; then
  echo "APP_DIR does not exist: ${APP_DIR}" >&2
  exit 1
fi

if [[ "${DEPLOY_MODE}" != "build" && "${DEPLOY_MODE}" != "pull" ]]; then
  echo "DEPLOY_MODE must be 'build' or 'pull'. Got: ${DEPLOY_MODE}" >&2
  exit 1
fi

cd "${APP_DIR}"

PREVIOUS_COMMIT="$(git rev-parse HEAD)"

run_deploy() {
  if [[ "${DEPLOY_MODE}" == "pull" ]]; then
    # For compose services backed by registry images.
    docker compose pull ${DEPLOY_SERVICES}
    docker compose up -d --force-recreate ${DEPLOY_SERVICES}
  else
    # For compose services backed by local Dockerfiles.
    docker compose build ${DEPLOY_SERVICES}
    docker compose up -d --force-recreate ${DEPLOY_SERVICES}
  fi
}

check_health() {
  local raw_urls url attempt
  raw_urls="${HEALTHCHECK_URLS//,/ }"

  for url in ${raw_urls}; do
    echo "Health checking: ${url}"
    for ((attempt = 1; attempt <= HEALTHCHECK_RETRIES; attempt++)); do
      if curl -fsS --max-time 5 "${url}" >/dev/null; then
        echo "Health check passed: ${url}"
        break
      fi

      if (( attempt == HEALTHCHECK_RETRIES )); then
        echo "Health check failed after ${HEALTHCHECK_RETRIES} attempts: ${url}" >&2
        return 1
      fi

      sleep "${HEALTHCHECK_INTERVAL_SEC}"
    done
  done
}

rollback() {
  echo "Rolling back to commit ${PREVIOUS_COMMIT}"
  git reset --hard "${PREVIOUS_COMMIT}"

  if [[ "${DEPLOY_MODE}" == "pull" ]]; then
    docker compose up -d --force-recreate ${DEPLOY_SERVICES}
  else
    docker compose build ${DEPLOY_SERVICES}
    docker compose up -d --force-recreate ${DEPLOY_SERVICES}
  fi
}

echo "Deploying branch '${DEPLOY_BRANCH}' in ${APP_DIR} (mode: ${DEPLOY_MODE})"
git fetch --prune origin "${DEPLOY_BRANCH}"
git checkout "${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"
NEW_COMMIT="$(git rev-parse HEAD)"

echo "Previous commit: ${PREVIOUS_COMMIT}"
echo "Target commit:   ${NEW_COMMIT}"

run_deploy

if check_health; then
  echo "Deployment complete and healthy"
  exit 0
fi

if [[ "${ROLLBACK_ON_FAILURE}" == "true" ]]; then
  echo "Deployment unhealthy; rollback is enabled"
  rollback

  if check_health; then
    echo "Rollback succeeded; services restored to previous healthy commit"
    exit 1
  fi

  echo "Rollback failed health checks; manual intervention required" >&2
  exit 2
fi

echo "Deployment unhealthy; rollback disabled" >&2
exit 1
