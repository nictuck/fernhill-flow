#!/usr/bin/env bash
# Gate 9 (Test stage): during a fix task the agent cannot edit tests.
# Active only while `.sdlc/fix-task` exists in the project root (created by
# /fix, removed when the fix is committed). (PreToolUse: Edit|Write|MultiEdit)
set -u
source "$(dirname "$0")/lib.sh"

MARKER="${CLAUDE_PROJECT_DIR:-$PWD}/.sdlc/fix-task"

if [ "${1:-}" = "--test" ]; then
  echo "protect-tests.sh"
  fail=0
  tmp=$(mktemp -d); export CLAUDE_PROJECT_DIR="$tmp"
  run_case 0 "no marker: test edit allowed"   "$(edit_json "$tmp/tests/foo.test.ts")" || fail=1
  mkdir -p "$tmp/.sdlc" && : > "$tmp/.sdlc/fix-task"
  run_case 2 "marker: tests/ blocked"         "$(edit_json "$tmp/tests/foo.test.ts")" || fail=1
  run_case 2 "marker: *.spec.js blocked"      "$(edit_json "$tmp/src/foo.spec.js")" || fail=1
  run_case 2 "marker: __tests__ blocked"      "$(edit_json "$tmp/src/__tests__/a.js")" || fail=1
  run_case 2 "marker: evals/ blocked"         "$(edit_json "$tmp/evals/case-01.json")" || fail=1
  run_case 0 "marker: src edit allowed"       "$(edit_json "$tmp/src/foo.ts")" || fail=1
  rm -rf "$tmp"
  exit $fail
fi

[ -f "$MARKER" ] || exit 0

input=$(hook_input)
case "$(json_field "$input" '.tool_name')" in Edit|Write|MultiEdit) ;; *) exit 0 ;; esac
path=$(json_field "$input" '.tool_input.file_path')
[ -n "$path" ] || exit 0

if printf '%s' "$path" | grep -Eq '(^|/)(tests?|__tests__|evals|spec)/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$'; then
  block "Blocked by protect-tests hook: a fix task is active ($MARKER) and tests are read-only. Make the failing test pass by changing the code. If the test itself is wrong, say so and stop; the engineer decides."
fi
exit 0
