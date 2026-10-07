#!/usr/bin/env bash
# Deploys a commit (default HEAD) to the server: uploads it as a new release, installs production
# dependencies, builds the React web UI (npm run build -> client/build), switches $APP_DIR/current to it, restarts
# the service and checks it answers.
# If the new release doesn't come up, the previous one is restored.
#
#   deploy/deploy.sh [git-ref]
#
# Only committed code is deployed (git archive) - uncommitted changes are not.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REF="${1:-HEAD}"
cd "$REPO_DIR"
SHA="$(git rev-parse --short "$REF^{commit}")"
if [ "$REF" = HEAD ] && [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: uncommitted changes are NOT deployed (deploying commit $SHA)." >&2
fi
RELEASE="$(date +%Y%m%d%H%M%S)-$SHA"

echo "==> Uploading $SHA to $TARGET:$APP_DIR/releases/$RELEASE"
# exports/ (a large CSV dump) and docs/ aren't needed to run the app.
git archive --format=tar "$REF" -- . ':(exclude)exports' ':(exclude)docs' \
  | ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p $APP_DIR/releases/$RELEASE && tar -x -C $APP_DIR/releases/$RELEASE"

run_remote activate "$RELEASE"
echo "==> Deployed $RELEASE"
