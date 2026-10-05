#!/bin/bash
set -euo pipefail

APP=/srv/homeserver/apps/handcheck
CADDY=/home/kon/Projects/baski-pro/Caddyfile

if [ ! -d "$APP/.git" ]; then
  git clone git@github.com-handcheck:BaskovKonstantin/handcheck.git "$APP"
else
  cd "$APP"
  git fetch origin main
  git reset --hard origin/main
fi

cd "$APP"
docker compose up -d --build
sleep 3
curl -fsS http://127.0.0.1:8810/api/health
echo
docker compose ps

if ! grep -q "handcheck.baski.pro" "$CADDY"; then
  cat >> "$CADDY" <<'EOF'

handcheck.baski.pro {
	encode gzip
	reverse_proxy 127.0.0.1:8810
}
EOF
  docker exec baski-web caddy reload --config /etc/caddy/Caddyfile
fi

echo "Caddy block ready"
