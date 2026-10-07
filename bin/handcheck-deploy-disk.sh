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

# Compare docker image ids whether compose returns 64-char or `docker images` returns 12-char.
normalize_image_id() {
  local raw="${1#sha256:}"
  echo "${raw:0:12}"
}

ids_match() {
  [[ "$(normalize_image_id "$1")" == "$(normalize_image_id "$2")" ]]
}

tag_rollback_image() {
  if docker image inspect handcheck-web:latest >/dev/null 2>&1; then
    echo "Tagging current handcheck-web:latest as handcheck-web:previous for rollback…"
    docker tag handcheck-web:latest handcheck-web:previous
  else
    echo "No handcheck-web:latest yet — skip rollback tag."
  fi
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
  local keep=()
  if [[ -d "$COMPOSE_DIR" ]]; then
    local current_id prev_id
    current_id="$(cd "$COMPOSE_DIR" && docker compose images -q web 2>/dev/null | head -1 || true)"
    prev_id="$(docker images handcheck-web:previous -q 2>/dev/null | head -1 || true)"
    if [[ -n "$current_id" ]]; then
      keep+=("$current_id")
    fi
    if [[ -n "$prev_id" ]] && [[ -n "$current_id" ]] && ! ids_match "$prev_id" "$current_id"; then
      keep+=("$prev_id")
    elif [[ -n "$prev_id" ]] && [[ -z "$current_id" ]]; then
      keep+=("$prev_id")
    fi
  fi
  if [[ "${#keep[@]}" -gt 0 ]]; then
    echo "Keeping HandCheck images for rollback: ${keep[*]}"
    while read -r img; do
      [[ -z "$img" ]] && continue
      local skip=0 k
      for k in "${keep[@]}"; do
        if ids_match "$img" "$k"; then
          skip=1
          break
        fi
      done
      if [[ "$skip" -eq 0 ]]; then
        docker rmi "$img" 2>/dev/null || true
      fi
    done < <(docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' | awk '/handcheck/ { print $1 }')
  fi
  echo "Pruning dangling images and build cache older than 24h (keeping running containers and volumes)…"
  docker image prune -f || true
  docker builder prune -af --filter "until=24h" || true
  if docker image inspect handcheck-web:previous >/dev/null 2>&1; then
    echo "Rollback hint: docker tag handcheck-web:previous handcheck-web:latest && cd ${COMPOSE_DIR} && docker compose up -d web"
  fi
  echo "Post-deploy prune finished."
}

case "$MODE" in
  precheck) precheck ;;
  tag-rollback) tag_rollback_image ;;
  post-prune) post_prune ;;
  *)
    echo "Usage: $0 {precheck|tag-rollback|post-prune}"
    exit 2
    ;;
esac
