#!/bin/bash
set -euo pipefail
KEY="$HOME/.ssh/id_ed25519_handcheck"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "${KEY_COMMENT:-handcheck-deploy}"
fi
if ! grep -q "github.com-handcheck" "$HOME/.ssh/config" 2>/dev/null; then
  printf '\nHost github.com-handcheck\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519_handcheck\n  IdentitiesOnly yes\n' >> "$HOME/.ssh/config"
fi
cat "${KEY}.pub"
