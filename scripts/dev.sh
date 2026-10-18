#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
env_file="$project_dir/.azure/fanpulse-dev/.env"
python_bin="$project_dir/.venv/bin/python"
export PYTHONPYCACHEPREFIX="$project_dir/.cache/python"

if [[ ! -x "$python_bin" ]]; then
  print -u2 "Missing .venv. Follow the one-time setup in README.md first."
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  print -u2 "Missing $env_file. Select the existing azd environment with: azd env select fanpulse-dev"
  exit 1
fi

set -a
source "$env_file"
set +a

required=(FOUNDRY_PROJECT_ENDPOINT FOUNDRY_VISION_MODEL_DEPLOYMENT FOUNDRY_MATCH_ANALYST_AGENT FOUNDRY_FAN_ENGAGEMENT_AGENT)
for name in $required; do
  if [[ -z ${(P)name:-} ]]; then
    print -u2 "Missing required setting: $name"
    exit 1
  fi
done

cleanup() {
  trap - EXIT INT TERM
  [[ -n ${backend_pid:-} ]] && kill "$backend_pid" 2>/dev/null || true
  [[ -n ${frontend_pid:-} ]] && kill "$frontend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

print "Starting FanPulse API at http://localhost:8000"
cd "$project_dir"
"$python_bin" -m uvicorn apps.api.app.main:app --reload --port 8000 &
backend_pid=$!

print "Starting FanPulse UI at http://localhost:5173"
cd "$project_dir/apps/web"
npm run dev &
frontend_pid=$!

print "Press Ctrl+C to stop both processes."
wait
