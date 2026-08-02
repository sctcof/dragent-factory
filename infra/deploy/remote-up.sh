#!/usr/bin/env bash
# Pull latest GHCR images and restart the stack on the deploy host.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/dragent-factory}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ghcr.yml}"
DRAGENT_API_IMAGE="${DRAGENT_API_IMAGE:?DRAGENT_API_IMAGE is required}"
DRAGENT_WEB_IMAGE="${DRAGENT_WEB_IMAGE:?DRAGENT_WEB_IMAGE is required}"
NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-http://localhost:8000}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

cd "$DEPLOY_PATH"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $DEPLOY_PATH/$COMPOSE_FILE" >&2
  exit 1
fi

if [[ -n "$GHCR_TOKEN" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-github}" --password-stdin
fi

export DRAGENT_API_IMAGE
export DRAGENT_WEB_IMAGE
export NEXT_PUBLIC_API_BASE

docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker compose -f "$COMPOSE_FILE" ps

echo "Deploy finished at $(date -Is)"
echo "API image: $DRAGENT_API_IMAGE"
echo "Web image: $DRAGENT_WEB_IMAGE"
