#!/usr/bin/env bash
# Gate 5: the agent may act up to the production gate and cannot pass it.
# Blocks production deploys from a Claude session, by CLI or by the Netlify
# MCP connector. The release manager approves the `production` GitHub
# environment instead. (PreToolUse: Bash, and the Netlify deploy MCP tool)
set -u
source "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--test" ]; then
  echo "production-gate.sh"
  fail=0
  run_case 2 "netlify deploy --prod"           "$(bash_cmd_json 'netlify deploy --prod --dir=dist')" || fail=1
  run_case 2 "netlify deploy --prodIfUnlocked" "$(bash_cmd_json 'netlify deploy --prodIfUnlocked')" || fail=1
  run_case 2 "netlify via npx"                 "$(bash_cmd_json 'npx netlify-cli deploy --prod')" || fail=1
  run_case 2 "netlify api restoreSiteDeploy"   "$(bash_cmd_json 'netlify api restoreSiteDeploy --data {}')" || fail=1
  run_case 2 "netlify after &&"                "$(bash_cmd_json 'make build && netlify deploy --dir=dist --prod')" || fail=1
  run_case 2 "gh workflow run (any)"           "$(bash_cmd_json 'gh workflow run deploy.yml -f environment=production')" || fail=1
  run_case 2 "gh workflow run via path"        "$(bash_cmd_json '/usr/local/bin/gh workflow run release.yml')" || fail=1
  run_case 2 "dispatch via API"                "$(bash_cmd_json 'gh api -X POST repos/x/y/actions/workflows/release.yml/dispatches')" || fail=1
  run_case 0 "netlify deploy (preview)"        "$(bash_cmd_json 'netlify deploy --dir=dist --alias=staging')" || fail=1
  run_case 0 "netlify status"                  "$(bash_cmd_json 'netlify status')" || fail=1
  run_case 0 "unrelated"                       "$(bash_cmd_json 'npm test')" || fail=1
  run_case 2 "MCP netlify deploy-site"         "$(jq -cn '{tool_name:"mcp__368cbf47-b2a8-41e4-bb9b-71f0eb4d84c3__netlify-deploy-services-updater",tool_input:{selectSchema:{operation:"deploy-site"}}}')" || fail=1
  run_case 0 "MCP netlify read tool"           "$(jq -cn '{tool_name:"mcp__368cbf47-b2a8-41e4-bb9b-71f0eb4d84c3__netlify-deploy-services-reader",tool_input:{}}')" || fail=1
  exit $fail
fi

input=$(hook_input)
tool=$(json_field "$input" '.tool_name')

# The Netlify MCP connector can publish a site directly; that is a production
# deploy without the gate, so it is blocked whatever the arguments.
case "$tool" in
  *netlify-deploy-services-updater*) block "Blocked by production-gate hook: the Netlify connector's deploy-site publishes straight to production. Releases go through the release workflow and the release manager's approval (docs/flow.md, Deploy model)." ;;
esac

[ "$tool" = "Bash" ] || exit 0
cmd=$(json_field "$input" '.tool_input.command')
[ -n "$cmd" ] || exit 0

reason="Blocked by production-gate hook: production releases are authorized by the release manager in GitHub (Actions → release run → Review deployments → production → Approve). Merging to main already deploys staging; tell the human it is ready."

check_segment() {
  local seg="$1"
  if printf '%s' "$seg" | grep -Eq '(^|[[:space:]]|/)(netlify|netlify-cli)([[:space:]]|$)'; then
    printf '%s' "$seg" | grep -Eq 'deploy([[:space:]]|$).*--prod' && block "$reason"
    printf '%s' "$seg" | grep -Eq 'api[[:space:]]+(restoreSiteDeploy|lockDeploy|unlockDeploy)' && block "$reason"
  fi
  if invokes "$seg" gh; then
    printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+workflow[[:space:]]+run([[:space:]]|$)' && block "$reason"
    printf '%s' "$seg" | grep -Eq 'actions/workflows/[^[:space:]]*/dispatches' && block "$reason"
  fi
  return 0
}
for_each_segment "$cmd" check_segment

exit 0
