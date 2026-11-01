#!/usr/bin/env bash
# Build stage: keep plan.md in sync with the diff, in the same commit.
# In a repo that has a plan/ directory with plans, a `git commit` that
# stages code but no plan file is blocked unless the message says
# `plan-unchanged`. Repos without plans (like this one) are unaffected.
# (PreToolUse: Bash)
set -u
source "$(dirname "$0")/lib.sh"

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"

is_code_path() { # paths that count as "the diff"
  ! printf '%s' "$1" | grep -Eq '^(plan/|docs/|\.github/|\.claude/|\.sdlc/|incidents/|evals/|README|CLAUDE\.md|REVIEW\.md|.*\.md$|.*\.lock$|package-lock\.json)'
}

if [ "${1:-}" = "--test" ]; then
  echo "plan-sync.sh"
  fail=0
  tmp=$(mktemp -d); export CLAUDE_PROJECT_DIR="$tmp"
  git -C "$tmp" init -q -b main && git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
  mkdir -p "$tmp/plan" "$tmp/src" && echo x > "$tmp/plan/0001-a.md" && echo y > "$tmp/src/a.js"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm init
  echo z > "$tmp/src/a.js" && git -C "$tmp" add -A
  run_case 2 "code staged, no plan staged"            "$(bash_cmd_json 'git commit -m "change a"')" || fail=1
  run_case 0 "escape hatch plan-unchanged"            "$(bash_cmd_json 'git commit -m "change a (plan-unchanged)"')" || fail=1
  echo w > "$tmp/plan/0001-a.md" && git -C "$tmp" add -A
  run_case 0 "code and plan staged"                   "$(bash_cmd_json 'git commit -m "change a"')" || fail=1
  git -C "$tmp" commit -qm ok; echo d > "$tmp/docs.md" && git -C "$tmp" add -A
  run_case 0 "only docs staged"                       "$(bash_cmd_json 'git commit -m docs')" || fail=1
  run_case 0 "not a commit"                           "$(bash_cmd_json 'git status')" || fail=1
  rm -rf "$tmp/plan" && git -C "$tmp" add -A && echo q > "$tmp/src/a.js" && git -C "$tmp" add -A
  run_case 0 "repo without plans"                     "$(bash_cmd_json 'git commit -m "change a"')" || fail=1
  rm -rf "$tmp"
  exit $fail
fi

input=$(hook_input)
[ "$(json_field "$input" '.tool_name')" = "Bash" ] || exit 0
cmd=$(json_field "$input" '.tool_input.command')
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit\b' || exit 0
printf '%s' "$cmd" | grep -q 'plan-unchanged' && exit 0

# Only repos that use plans
ls "$ROOT"/plan/*.md >/dev/null 2>&1 || exit 0

staged=$(git -C "$ROOT" diff --cached --name-only 2>/dev/null)
# `git commit -a` / `-am` stage tracked changes implicitly
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+commit\b.*[[:space:]]-(a|am|all)\b'; then
  staged=$(printf '%s\n%s' "$staged" "$(git -C "$ROOT" diff --name-only 2>/dev/null)")
fi
[ -n "$staged" ] || exit 0

code=0; plan=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in plan/*) plan=1 ;; esac
  if is_code_path "$f"; then code=1; fi
done <<< "$staged"

if [ "$code" -eq 1 ] && [ "$plan" -eq 0 ]; then
  block "Blocked by plan-sync hook: this commit changes code but no file under plan/. If the implementation departed from the plan, update plan/NNNN-*.md in the same commit. If the plan still matches exactly, add 'plan-unchanged' to the commit message."
fi
exit 0
