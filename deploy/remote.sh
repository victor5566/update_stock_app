# Runs ON THE SERVER, sent over ssh by setup-server.sh / deploy.sh / rollback.sh with the settings
# (APP_DIR, APP_USER, SERVICE_NAME, NODE_VERSION, APP_TZ, KEEP_RELEASES, DEPLOY_USER) in the environment.
#   remote.sh setup [env-file]   one-time provisioning, as root
#   remote.sh activate <release> install deps, switch current, restart, health check (rolls back on failure)
#   remote.sh rollback [release] switch current to the given / previous release
#   remote.sh list               list releases
set -euo pipefail
export PATH="/usr/local/bin:$PATH"

RELEASES="$APP_DIR/releases"
SHARED="$APP_DIR/shared"
CURRENT="$APP_DIR/current"

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "==> $*"; }

# Node must be >= 22.8.0, and never 22.7.0 (UTF-8 JIT bug - see db.js).
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=8)?0:1)'
}

cmd_setup() {
  local env_file="${1:-}"
  [ "$(id -u)" = 0 ] || die "setup must run as root"
  # The unit sets PrivateTmp=true, so the service would not see an APP_DIR under /tmp.
  case "$APP_DIR" in /tmp/*|/var/tmp/*) die "APP_DIR must not be under /tmp or /var/tmp" ;; esac
  command -v systemctl >/dev/null || die "systemd is required"
  command -v curl >/dev/null || die "curl is required (apt install curl / dnf install curl)"
  command -v tar >/dev/null || die "tar is required"

  if node_ok; then
    log "Node $(node -v) already installed at $(command -v node)"
  else
    log "Installing Node $NODE_VERSION with n"
    curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n | bash -s install "$NODE_VERSION"
    hash -r
    node_ok || die "Node install failed or too old: $(node -v 2>/dev/null || echo none)"
    log "Node $(node -v) installed"
  fi
  local node_bin systemctl_bin journalctl_bin
  node_bin="$(command -v node)"
  systemctl_bin="$(command -v systemctl)"
  journalctl_bin="$(command -v journalctl)"

  if ! id "$APP_USER" >/dev/null 2>&1; then
    log "Creating system user $APP_USER"
    useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  fi

  log "Creating $APP_DIR"
  mkdir -p "$RELEASES" "$SHARED"
  chown "$DEPLOY_USER:$APP_USER" "$APP_DIR" "$RELEASES" "$SHARED"
  chmod 755 "$APP_DIR" "$RELEASES"
  chmod 750 "$SHARED"

  if [ -n "$env_file" ]; then
    log "Installing .env"
    install -o "$DEPLOY_USER" -g "$APP_USER" -m 640 "$env_file" "$SHARED/.env"
    rm -f "$env_file"
  elif [ ! -f "$SHARED/.env" ]; then
    echo "WARNING: $SHARED/.env does not exist - create it (see .env.example) before deploying." >&2
  fi

  log "Writing /etc/systemd/system/$SERVICE_NAME.service"
  cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Stock symbol manager ($SERVICE_NAME)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$CURRENT
ExecStart=$node_bin server.js
Environment=NODE_ENV=production
Environment=TZ=$APP_TZ
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  if [ "$DEPLOY_USER" != root ]; then
    log "Allowing $DEPLOY_USER to restart $SERVICE_NAME without a password"
    local sudoers="/etc/sudoers.d/$SERVICE_NAME-deploy"
    cat > "$sudoers.tmp" <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $systemctl_bin restart $SERVICE_NAME, $systemctl_bin status $SERVICE_NAME, $systemctl_bin status $SERVICE_NAME --no-pager, $journalctl_bin -u $SERVICE_NAME *
EOF
    chmod 440 "$sudoers.tmp"
    visudo -cf "$sudoers.tmp" >/dev/null || { rm -f "$sudoers.tmp"; die "generated sudoers rule is invalid"; }
    mv "$sudoers.tmp" "$sudoers"
  fi

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  log "Setup done. Deploy with deploy/deploy.sh"
}

env_port() {
  local p
  p="$(grep -E '^[[:space:]]*PORT=' "$SHARED/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"' \r")"
  echo "${p:-3000}"
}

restart_and_check() {
  local port url i
  port="$(env_port)"
  url="http://127.0.0.1:$port/config.js"
  sudo -n systemctl restart "$SERVICE_NAME"
  for i in $(seq 1 20); do
    sleep 1
    if node -e "fetch('$url').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
      log "Healthy: $url answered after ${i}s"
      return 0
    fi
  done
  echo "Health check failed: $url did not answer within 20s. Recent log:" >&2
  sudo -n journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2 || true
  return 1
}

switch_to() {
  ln -sfn "$1" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$CURRENT"
}

cmd_activate() {
  local name="${1:?release name required}" dir prev=""
  dir="$RELEASES/$name"
  [ -d "$dir" ] || die "release $dir not found"
  [ -f "$SHARED/.env" ] || die "$SHARED/.env missing - run setup-server.sh with --env-file, or create it on the server"
  node_ok || die "Node on the server is missing or older than 22.8.0 ($(node -v 2>/dev/null || echo none))"

  ln -sfn "$SHARED/.env" "$dir/.env"
  log "npm ci (production dependencies) with Node $(node -v)"
  (cd "$dir" && npm ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error)

  [ -L "$CURRENT" ] && prev="$(readlink -f "$CURRENT")"
  log "Switching current -> releases/$name"
  switch_to "$dir"
  if ! restart_and_check; then
    if [ -n "$prev" ] && [ "$prev" != "$dir" ]; then
      echo "Rolling back to $(basename "$prev")" >&2
      switch_to "$prev"
      restart_and_check || true
      # Don't let a release that never ran take a slot that rollback.sh could use.
      rm -rf "$dir"
    fi
    die "deploy of $name failed"
  fi

  # Keep the newest KEEP_RELEASES (by name = timestamp), never the live one.
  local live old
  live="$(readlink -f "$CURRENT")"
  ls -1 "$RELEASES" | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
    [ "$RELEASES/$old" = "$live" ] && continue
    rm -rf "${RELEASES:?}/$old"
    echo "Removed old release $old"
  done
}

cmd_list() {
  local live="" r
  [ -L "$CURRENT" ] && live="$(basename "$(readlink -f "$CURRENT")")"
  for r in $(ls -1 "$RELEASES" | sort -r); do
    if [ "$r" = "$live" ]; then echo "* $r  (current)"; else echo "  $r"; fi
  done
}

cmd_rollback() {
  local target="${1:-}" live
  [ -L "$CURRENT" ] || die "no current release"
  live="$(basename "$(readlink -f "$CURRENT")")"
  if [ -z "$target" ]; then
    # The newest release older than the live one.
    target="$(ls -1 "$RELEASES" | sort -r | awk -v live="$live" 'found { print; exit } $0 == live { found = 1 }')"
    [ -n "$target" ] || die "no release older than $live"
  fi
  [ -d "$RELEASES/$target" ] || die "release $target not found"
  [ "$target" != "$live" ] || die "$target is already current"
  log "Rolling back $live -> $target"
  switch_to "$RELEASES/$target"
  restart_and_check || die "rolled-back release did not come up healthy"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  setup) cmd_setup "$@" ;;
  activate) cmd_activate "$@" ;;
  rollback) cmd_rollback "$@" ;;
  list) cmd_list ;;
  *) die "unknown command: $cmd" ;;
esac
