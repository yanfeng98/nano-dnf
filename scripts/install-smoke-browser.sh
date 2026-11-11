#!/usr/bin/env bash
set -euo pipefail

# Public workflow annotations remain readable when downloading job logs needs
# authentication. Preserve the failing command's exit status and stop there.
run_install_step() {
  local label="$1" log_file status=0 detail
  shift
  log_file=$(mktemp)
  "$@" >"$log_file" 2>&1 || status=$?
  cat "$log_file"
  if (( status != 0 )); then
    detail=$(tail -n 20 "$log_file")
    detail=${detail//%/%25}
    detail=${detail//$'\r'/%0D}
    detail=${detail//$'\n'/%0A}
    echo "::error title=Smoke browser installation: $label::Exit $status: $detail"
  fi
  rm -- "$log_file"
  return "$status"
}

run_install_step "npm package" npm install --no-save --no-package-lock playwright@1.63.0
run_install_step "Chromium and system dependencies" npx playwright install --with-deps chromium
