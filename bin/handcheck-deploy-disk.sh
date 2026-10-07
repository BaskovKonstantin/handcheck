#!/usr/bin/env bash
# Disk guard for konBas HandCheck deploy (safe cleanup; never touches volumes).
set -euo pipefail

MODE="${1:-precheck}"
THRESHOLD_GB="${HANDCHECK_DEPLOY_MIN_GB:-3}"
THRESHOLD_KB=$((THRESHOLD_GB * 1024 * 1024))
COMPOSE_PROJECT="${HANDCHECK_COMPOSE_PROJECT:-handcheck}"
COMPOSE_DIR="${HANDCHECK_COMPOSE_DIR:-/srv/homeserver/apps/handcheck}"

kb_free_root() {
  df -Pk / | awk 'NR==2 { print $4 }'
}

kb_free_docker() {
  local root
  root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  if [[ -d "$root" ]]; then
    df -Pk "$root" | awk 'NR==2 { print $4 }'
  else
    kb_free_root
  fi
}

print_disk_report() {
  echo "=== Disk before ${MODE} ==="
  df -h / || true
  docker system df || true
}

try_safe_cleanup() {
  echo "Trying safe Docker cleanup (dangling images, old build cache)…"
  docker image prune -f || true
  docker builder prune -af --filter "until=24h" || true
}

fail_low_space() {
  local root_kb="$1"
  local docker_kb="$2"
  local root_gb=$((root_kb / 1024 / 1024))
  local docker_gb=$((docker_kb / 1024 / 1024))
  echo "ERROR: Недостаточно места на konBas: / ≈ ${root_gb} ГБ свободно, Docker data ≈ ${docker_gb} ГБ (нужно ≥ ${THRESHOLD_GB} ГБ)."
  echo "ERROR: Not enough free disk on konBas (need at least ${THRESHOLD_GB} GB on / and Docker root)."
  exit 42
}

precheck() {
  print_disk_report
  local root_kb docker_kb
  root_kb="$(kb_free_root)"
  docker_kb="$(kb_free_docker)"
  if [[ "$root_kb" -lt "$THRESHOLD_KB" || "$docker_kb" -lt "$THRESHOLD_KB" ]]; then
    try_safe_cleanup
    root_kb="$(kb_free_root)"
    docker_kb="$(kb_free_docker)"
  fi
  if [[ "$root_kb" -lt "$THRESHOLD_KB" || "$docker_kb" -lt "$THRESHOLD_KB" ]]; then
    fail_low_space "$root_kb" "$docker_kb"
  fi
  echo "Disk precheck OK (≥ ${THRESHOLD_GB} GB free on / and Docker root)."
}

post_prune() {
  print_disk_report
  echo "Pruning dangling images and build cache older than 24h (keeping running containers and volumes)…"
  docker image prune -f || true
  docker builder prune -af --filter "until=24h" || true
  local keep=()
  if [[ -d "$COMPOSE_DIR" ]]; then
    (
      cd "$COMPOSE_DIR"
      local current_id prev_id
      current_id="$(docker compose images -q web 2>/dev/null | head -1 || true)"
      if [[ -n "$current_id" ]]; then
        keep+=("$current_id")
        prev_id="$(docker images --format '{{.ID}} {{.Repository}}' | awk -v cur="$current_id" '$2 ~ /handcheck/ && $1 != cur { print $1; exit }')"
        if [[ -n "$prev_id" ]]; then
          keep+=("$prev_id")
        fi
      fi
    )
  fi
  if [[ "${#keep[@]}" -gt 0 ]]; then
    echo "Keeping HandCheck images for rollback: ${keep[*]}"
    docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' | awk '/handcheck/ { print $1 }' | while read -r img; do
      local skip=0
      for k in "${keep[@]}"; do
        if [[ "$img" == "$k" ]]; then skip=1; break; fi
      done
      if [[ "$skip" -eq 0 ]]; then
        docker rmi "$img" 2>/dev/null || true
      fi
    done
  fi
  echo "Post-deploy prune finished."
}

case "$MODE" in
  precheck) precheck ;;
  post-prune) post_prune ;;
  *)
    echo "Usage: $0 {precheck|post-prune}"
    exit 2
    ;;
esac
