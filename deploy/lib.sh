# Shared by setup-server.sh, deploy.sh and rollback.sh (sourced, not run).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
CONF="${DEPLOY_CONF:-$DEPLOY_DIR/deploy.conf}"

if [ ! -f "$CONF" ]; then
  echo "Missing $CONF - copy deploy/deploy.conf.example to deploy/deploy.conf and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$CONF"

: "${DEPLOY_HOST:?DEPLOY_HOST is not set in $CONF}"
: "${DEPLOY_USER:?DEPLOY_USER is not set in $CONF}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/stock-app}"
APP_USER="${APP_USER:-stockapp}"
SERVICE_NAME="${SERVICE_NAME:-stock-app}"
NODE_VERSION="${NODE_VERSION:-22}"
APP_TZ="${APP_TZ:-Asia/Taipei}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

SSH_OPTS=(-p "$DEPLOY_SSH_PORT" -o ServerAliveInterval=30)
SCP_OPTS=(-P "$DEPLOY_SSH_PORT")
if [ -n "${DEPLOY_SSH_KEY:-}" ]; then
  SSH_OPTS+=(-i "${DEPLOY_SSH_KEY/#\~/$HOME}")
  SCP_OPTS+=(-i "${DEPLOY_SSH_KEY/#\~/$HOME}")
fi
TARGET="$DEPLOY_USER@$DEPLOY_HOST"

# The settings remote.sh needs, as a shell-quoted `VAR=value ...` prefix for the remote command.
remote_env() {
  local v out=""
  for v in APP_DIR APP_USER SERVICE_NAME NODE_VERSION APP_TZ KEEP_RELEASES DEPLOY_USER; do
    out+="$v=$(printf '%q' "${!v}") "
  done
  printf '%s' "$out"
}

# Runs deploy/remote.sh <command> [args] on the server, without a terminal (no sudo password prompts).
run_remote() {
  local args="" a
  for a in "$@"; do args+=" $(printf '%q' "$a")"; done
  ssh "${SSH_OPTS[@]}" "$TARGET" "$(remote_env) bash -s --$args" < "$DEPLOY_DIR/remote.sh"
}
