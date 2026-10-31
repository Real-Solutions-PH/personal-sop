#!/usr/bin/env bash
# Load test against a private, throwaway stack: Postgres, Redis, a stub for
# GoTrue's keys and the model provider (backend/scripts/load_test/stub.py),
# and the API in containers capped at a Fargate task's CPU and memory.
# Nothing here touches the dev database, Supabase or any provider.
#
#   scripts/load-test.sh <image> <label> <api-tasks> <cpus> <memory> <workers> \
#       <db-cpus> <db-memory> <db-max-connections> [extra API env...]
#
# e.g. production (100 users): 2 tasks of 1 vCPU / 2 GB, two workers each,
# against a database the size of db.t4g.medium:
#   scripts/load-test.sh unfurl-backend:local after 2 1 2g 2 2 4g 400
#
# Results land in $LOAD_TEST_OUT (default ./load-test-results) as <label>.json.
# USERS (default 100), RAMP (seconds, default 10) and KEEP=1 (leave the stack
# up) are read from the environment. Everything is named cap-*; the script
# removes it all on exit. MOUNT_CODE=0: see below.
set -euo pipefail

image=$1 label=$2 tasks=$3 cpus=$4 mem=$5 workers=$6
db_cpus=$7 db_mem=$8 db_max=$9
shift 9
extra=("$@")

root=$(cd "$(dirname "$0")/.." && pwd)
out=${LOAD_TEST_OUT:-$root/load-test-results}
mkdir -p "$out"
net=cap-net
keys=$(mktemp -d)
chmod 777 "$keys"

cleanup() {
  [ "${KEEP:-0}" = 1 ] && return
  docker rm -f $(docker ps -aq --filter name='^cap-') >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$keys"
}
trap cleanup EXIT
cleanup
docker network create "$net" >/dev/null

docker run -d --name cap-pg --network "$net" --cpus "$db_cpus" --memory "$db_mem" \
  -e POSTGRES_PASSWORD=loadtest -e POSTGRES_DB=app \
  pgvector/pgvector:pg18 -c max_connections="$db_max" >/dev/null
docker run -d --name cap-redis --network "$net" redis:8-alpine >/dev/null

lt=(-v "$root/backend/scripts/load_test:/lt:ro" -v "$keys:/keys")
# MOUNT_CODE=0 runs the image's own code (e.g. the deployed build, as a
# baseline); by default this checkout's backend/app is mounted over it.
code=(-v "$root/backend/app:/app/backend/app:ro")
[ "${MOUNT_CODE:-1}" = 0 ] && code=()
docker run -d --name cap-stub --user 0 --network "$net" --network-alias stub "${lt[@]}" \
  -e STUB_REPLY_TOKENS="${STUB_REPLY_TOKENS:-150}" \
  -e STUB_REPLY_SECONDS="${STUB_REPLY_SECONDS:-6}" \
  --entrypoint python "$image" /lt/stub.py >/dev/null

env=(
  -e ENVIRONMENT=local -e PROJECT_NAME=Unfurl -e FRONTEND_HOST=http://localhost
  -e FIRST_SUPERUSER=admin@example.com -e FIRST_SUPERUSER_PASSWORD=loadtest-admin
  -e POSTGRES_SERVER=cap-pg -e POSTGRES_PORT=5432 -e POSTGRES_DB=app
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=loadtest
  -e POSTGRES_APP_USER=app_user -e POSTGRES_APP_PASSWORD=loadtest-app
  -e REDIS_URL=redis://cap-redis:6379/0
  -e SUPABASE_URL=http://stub:9000 -e SUPABASE_JWT_ISSUER=http://stub:9000/auth/v1
  -e SUPABASE_ANON_KEY=x -e SUPABASE_SERVICE_ROLE_KEY=x
  -e AI_ENABLED=true -e AI_SERVER_FALLBACK=true -e DEFAULT_LLM_PROVIDER=nebius
  -e NEBIUS_API_KEY=stub -e NEBIUS_BASE_URL=http://stub:9000/v1/
  -e JOBS_ENABLED=true -e PUSH_ENABLED=false -e OCR_ENABLED=false
  -e CLIENT_IP_HEADER=X-Load-Client-IP
  -e RATE_LIMIT_AI_PER_MINUTE=20 -e RATE_LIMIT_ACCOUNT_PER_MINUTE=10
  -e FORWARDED_ALLOW_IPS='*'
)
for e in ${extra[@]+"${extra[@]}"}; do env+=(-e "$e"); done

until docker exec cap-pg pg_isready -U postgres -d app >/dev/null 2>&1; do sleep 1; done
sleep 2
# Schema and the seed the API needs to provision users (roles, permissions,
# the default tenant, Fern's agent); the GoTrue superuser is not needed.
docker run --rm --network "$net" "${env[@]}" ${code[@]+"${code[@]}"} --entrypoint bash "$image" -c '
  alembic upgrade head >/dev/null && python - <<EOF
from sqlmodel import Session
from app.core.db import engine
from app.modules.iam.permissions.seed import seed_permissions
from app.modules.iam.rbac.seed import seed_role_permissions
from app.modules.iam.roles.seed import seed_roles
from app.modules.iam.tenants.seed import seed_tenants
from app.modules.ai.agents.seed import seed_agents
from app.modules.ai.tools.seed import seed_tools
with Session(engine) as s:
    for f in (seed_roles, seed_permissions, seed_role_permissions, seed_tenants, seed_agents, seed_tools):
        f(s)
    s.commit()
print("seeded")
EOF'
docker exec cap-pg psql -U postgres -d app -qc "ALTER ROLE app_user LOGIN PASSWORD 'loadtest-app'"

# The production command (infra/lib/prod-stack.ts); API_CMD=fastapi runs
# the one deployed before it, as a baseline.
api_cmd=(uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$workers"
  --proxy-headers --timeout-keep-alive 310 --timeout-worker-healthcheck 30)
[ "${API_CMD:-}" = fastapi ] && api_cmd=(fastapi run --workers "$workers" --port 8000 app/main.py)
apis=()
for i in $(seq 1 "$tasks"); do
  docker run -d --name "cap-api-$i" --network "$net" --memory "$mem" \
    "${env[@]}" ${code[@]+"${code[@]}"} "$image" \
    "${api_cmd[@]}" >/dev/null
  apis+=("http://cap-api-$i:8000")
done
docker run -d --name cap-worker --network "$net" --cpus 0.5 --memory 1g \
  "${env[@]}" ${code[@]+"${code[@]}"} "$image" \
  procrastinate --app=app.modules.jobs.app.jobs_app worker >/dev/null
for i in $(seq 1 "$tasks"); do
  until docker exec "cap-api-$i" curl -fs http://localhost:8000/api/v1/utils/health-check/ >/dev/null 2>&1; do sleep 1; done
  # The CPU cap goes on once the API is up: on a busy host a quarter vCPU
  # can take many minutes just to import the app, which Fargate does not.
  docker update --cpus "$cpus" "cap-api-$i" >/dev/null
done

# CPU seconds the API containers use over the run.
cpu_ns() { for i in $(seq 1 "$tasks"); do docker exec "cap-api-$i" cat /sys/fs/cgroup/cpu.stat | awk '/usage_usec/{print $2}'; done | paste -sd+ - | bc; }
before=$(cpu_ns)
docker run --rm --name cap-load --user 0 --network "$net" "${lt[@]}" -v "$out:/out" \
  --entrypoint python "$image" /lt/run.py \
  --api "$(IFS=,; echo "${apis[*]}")" --users "${USERS:-100}" --ramp "${RAMP:-10}" \
  --out "/out/$label.json"
after=$(cpu_ns)
echo "api cpu seconds: $(echo "($after - $before) / 1000000" | bc -l | cut -c1-6)" | tee "$out/$label.cpu"
for i in $(seq 1 "$tasks"); do docker stats --no-stream --format '{{.Name}} mem {{.MemUsage}}' "cap-api-$i"; done | tee -a "$out/$label.cpu"
docker run --rm --network "$net" --entrypoint curl "$image" -s http://stub:9000/_calls >"$out/$label.calls.json"
docker logs cap-api-1 2>&1 | grep -E "ERROR|Traceback|TimeoutError|QueuePool" | sort | uniq -c | sort -rn | head -20 >"$out/$label.api-errors.txt" || true
