#!/usr/bin/env bash
# One-time server setup: Node (>= 22.8.0), the service user, $APP_DIR, the systemd unit and a
# sudoers rule letting DEPLOY_USER restart the service. Safe to re-run (e.g. after changing deploy.conf).
#
#   deploy/setup-server.sh [--env-file path/to/server.env]
#
# --env-file uploads that file as the server's .env ($APP_DIR/shared/.env). Don't pass your local
# .env unchanged: PUBLIC_URL there is the WSL address - set it to the server's address, or remove it.
# DEPLOY_USER needs sudo on the server for this script (you'll be asked for the sudo password).
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -z "$ENV_FILE" ] || [ -f "$ENV_FILE" ] || { echo "No such file: $ENV_FILE" >&2; exit 1; }

TMP="/tmp/$SERVICE_NAME-setup.$$"
echo "==> Uploading setup files to $TARGET:$TMP"
ssh "${SSH_OPTS[@]}" "$TARGET" "umask 077 && mkdir -p $TMP && cat > $TMP/remote.sh" < "$DEPLOY_DIR/remote.sh"
REMOTE_ENV_ARG=""
if [ -n "$ENV_FILE" ]; then
  ssh "${SSH_OPTS[@]}" "$TARGET" "umask 077 && cat > $TMP/env" < "$ENV_FILE"
  REMOTE_ENV_ARG="$TMP/env"
fi

# -t: sudo may need to ask for a password.
ssh -t "${SSH_OPTS[@]}" "$TARGET" \
  "sudo env $(remote_env) bash $TMP/remote.sh setup $REMOTE_ENV_ARG; status=\$?; rm -rf $TMP; exit \$status"
