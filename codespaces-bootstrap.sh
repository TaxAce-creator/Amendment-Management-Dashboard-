#!/usr/bin/env bash
set -euo pipefail

EMAIL="${1:-${TEST_AUTH_EMAIL:-}}"
NAME="${2:-Lyndon Alvarado}"

if [[ -z "$EMAIL" ]]; then
  echo "Usage: bash scripts/codespaces-bootstrap.sh <email@taxacebsi.com> [Display Name]"
  exit 1
fi

if [[ "$EMAIL" != *@taxacebsi.com ]]; then
  echo "Email must use the @taxacebsi.com domain."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

replace_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

replace_env TEST_AUTH_EMAIL "$EMAIL"

CURRENT_CODE="$(grep '^TEST_AUTH_ACCESS_CODE=' .env | cut -d= -f2- || true)"
if [[ -z "$CURRENT_CODE" || "$CURRENT_CODE" == *CHANGE_ME* || ${#CURRENT_CODE} -lt 24 ]]; then
  CURRENT_CODE="$(openssl rand -hex 16)"
  replace_env TEST_AUTH_ACCESS_CODE "$CURRENT_CODE"
fi

pnpm install --frozen-lockfile --force

docker compose up -d

printf 'Waiting for PostgreSQL to become healthy'
for _ in {1..60}; do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' amendment-management-dashboard-postgres-1 2>/dev/null || true)"
  if [[ "$STATUS" == "healthy" ]]; then
    echo
    break
  fi
  printf '.'
  sleep 2
done

STATUS="$(docker inspect -f '{{.State.Health.Status}}' amendment-management-dashboard-postgres-1 2>/dev/null || true)"
if [[ "$STATUS" != "healthy" ]]; then
  echo
  echo "PostgreSQL did not become healthy in time."
  docker compose ps
  exit 1
fi

pnpm db:migrate
pnpm db:seed
pnpm user:bootstrap "$EMAIL" "$NAME"

echo
echo "Codespaces bootstrap complete."
echo "Email: $EMAIL"
echo "Test code: $CURRENT_CODE"
echo "Start the app with: pnpm dev"
