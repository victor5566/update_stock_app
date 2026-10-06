#!/usr/bin/env bash
# Switches the server back to an earlier release and restarts the service.
#
#   deploy/rollback.sh            back to the release before the current one
#   deploy/rollback.sh <release>  to a specific release
#   deploy/rollback.sh --list     list releases on the server
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ "${1:-}" = --list ]; then
  run_remote list
else
  run_remote rollback "${1:-}"
fi
