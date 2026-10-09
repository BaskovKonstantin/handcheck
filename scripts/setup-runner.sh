#!/bin/bash
set -euo pipefail

TOKEN="$1"
DIR="${RUNNER_DIR:-${HOME}/actions-runners/handcheck}"
mkdir -p "$DIR"
cd "$DIR"

if [ ! -f ./config.sh ]; then
  VER=2.337.0
  curl -fsSL -o actions-runner-linux-x64.tar.gz \
    "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
  tar xzf actions-runner-linux-x64.tar.gz
  rm -f actions-runner-linux-x64.tar.gz
fi

if [ ! -f .runner ]; then
  ./config.sh --unattended \
    --url https://github.com/BaskovKonstantin/handcheck \
    --token "$TOKEN" \
    --name "${RUNNER_NAME:-handcheck-runner}" \
    --labels "${RUNNER_LABELS:-handcheck,self-hosted}" \
    --work _work \
    --replace
fi

sudo ./svc.sh install kon || true
sudo ./svc.sh start
./svc.sh status || sudo ./svc.sh status || true
echo "Runner ready"
