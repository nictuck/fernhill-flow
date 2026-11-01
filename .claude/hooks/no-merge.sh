#!/usr/bin/env bash
# Gate: the agent has no route to main or production.
# Blocks merging, approving, pushing to main/production and starting
# workflow runs from a Claude session. A human does these in GitHub.
#
# Exception: `gh pr merge N … --body "… EX-NNN …"` is allowed when that
# exception, read from the platform repo's main through the GitHub API, is
# active, unexpired, grants `merge`, lists this repo, and the PR changes no
# guardrail paths. Nothing else is ever delegated. (PreToolUse: Bash)
set -u
source "$(dirname "$0")/lib.sh"

# The trust anchor is hardcoded on purpose: nothing in the working tree,
# the environment or a local ref decides which exceptions exist.
PLATFORM_REPO="nictuck/fernhill-platform"
GUARDRAIL_PATHS='^(\.claude/|\.github/|exceptions/|personas/|CODEOWNERS$|REVIEW\.md$)'

# --test fixtures arrive as argv (never env): --fixtures <dir> <repo> <files-file>
FIXTURES_DIR=""; FIXTURE_REPO=""; FIXTURE_FILES=""
if [ "${1:-}" = "--fixtures" ]; then FIXTURES_DIR="$2"; FIXTURE_REPO="$3"; FIXTURE_FILES="$4"; shift 4; fi

# ---- exceptions ---------------------------------------------------------------
exception_text() { # exception_text <id> — the file as it is on the platform's main
  local id="$1" name
  if [ -n "$FIXTURES_DIR" ]; then cat "$FIXTURES_DIR"/"$id"-*.md 2>/dev/null; return; fi
  name=$(gh api "repos/$PLATFORM_REPO/contents/exceptions?ref=main" --jq '.[].name' 2>/dev/null | grep -m1 "^$id-") || return 1
  gh api "repos/$PLATFORM_REPO/contents/exceptions/$name?ref=main" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null
}

exception_grants() { # exception_grants <id> <grant> → 0 if active, unexpired and granting
  local id="$1" grant="$2" text exp
  text=$(exception_text "$id") || return 1
  [ -n "$text" ] || return 1
  printf '%s\n' "$text" | grep -q '^status: *active *$' || return 1
  printf '%s\n' "$text" | sed -n 's/^grants: *//p' | tr -d '[]' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -qx "$grant" || return 1
  exp=$(printf '%s\n' "$text" | sed -n 's/^expires: *//p' | head -1 | tr -d '"')
  [[ "$exp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 1          # no expiry = no grant
  [[ "$(date +%F)" > "$exp" ]] && return 1
  return 0
}

exception_covers_pr() { # exception_covers_pr <id> <segment> → 0 if it lists this repo and the PR touches no guardrails
  local id="$1" seg="$2" text pr repoflag repo files
  text=$(exception_text "$id") || return 1
  pr=$(printf '%s' "$seg" | sed -n 's/.*gh[[:space:]]*pr[[:space:]]*merge//p' | grep -oE '(^|[[:space:]])[0-9]+([[:space:]]|$)' | head -1 | tr -d '[:space:]')
  [ -n "$pr" ] || { echo "no-merge: name the PR by number (gh pr merge N …) so the hook can inspect its files" >&2; return 1; }
  repoflag=$(printf '%s' "$seg" | grep -oE '(-R|--repo)[[:space:]]+[^[:space:]]+' | awk '{print $2}' | head -1)
  if [ -n "$FIXTURES_DIR" ]; then
    repo="$FIXTURE_REPO"; files=$(cat "$FIXTURE_FILES" 2>/dev/null)
  else                                                   # fail closed if gh cannot answer
    repo=$(gh repo view ${repoflag:+-R "$repoflag"} --json name --jq .name 2>/dev/null) || return 1
    files=$(gh pr view "$pr" ${repoflag:+-R "$repoflag"} --json files --jq '.files[].path' 2>/dev/null) || return 1
  fi
  [ -n "$repo" ] || return 1
  printf '%s\n' "$text" | sed -n 's/^repos: *//p' | tr -d '[]' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -qx "$repo" \
    || { echo "no-merge: $id does not list repo '$repo'" >&2; return 1; }
  if printf '%s\n' "$files" | grep -Eq "$GUARDRAIL_PATHS"; then
    echo "no-merge: PR #$pr changes guardrails (.claude/, .github/, exceptions/, personas/, CODEOWNERS, REVIEW.md); no exception covers that — a human merges it" >&2
    return 1
  fi
  return 0
}

# ---- self-test ----------------------------------------------------------------------
if [ "${1:-}" = "--test" ]; then
  echo "no-merge.sh"
  fail=0
  tmp=$(mktemp -d); files="$tmp/files"
  printf 'src/a.ts\ntests/a.test.ts\nplan/0001-a.md\n' > "$files"
  tomorrow=$(date -v+1d +%F 2>/dev/null || date -d tomorrow +%F)
  repos='repos: [fernhill-platform, fernhill-flow]'
  printf -- '---\nid: EX-001\nstatus: active\ngrants: [merge]\n%s\nexpires: %s\n---\n' "$repos" "$tomorrow" > "$tmp/EX-001-ok.md"
  printf -- '---\nid: EX-002\nstatus: active\ngrants: [merge]\n%s\nexpires: 2020-01-01\n---\n' "$repos" > "$tmp/EX-002-expired.md"
  printf -- '---\nid: EX-003\nstatus: revoked\ngrants: [merge]\n%s\nexpires: %s\n---\n' "$repos" "$tomorrow" > "$tmp/EX-003-revoked.md"
  printf -- '---\nid: EX-004\nstatus: active\ngrants: [approve-plan]\n%s\nexpires: %s\n---\n' "$repos" "$tomorrow" > "$tmp/EX-004-other-grant.md"
  printf -- '---\nid: EX-005\nstatus: active\ngrants: [merge]\n%s\n---\n' "$repos" > "$tmp/EX-005-no-expiry.md"
  HOOK_TEST_ARGS="--fixtures $tmp fernhill-flow $files"
  ok="--squash --body Merged under EX-001 after /review: ok"
  # always blocked
  run_case 2 "gh pr merge"                    "$(bash_cmd_json 'gh pr merge 12 --squash')" || fail=1
  run_case 2 "gh pr merge via full path"      "$(bash_cmd_json '/opt/homebrew/bin/gh pr merge 12 --squash')" || fail=1
  run_case 2 "gh pr review --approve"         "$(bash_cmd_json 'gh pr review 12 --approve')" || fail=1
  run_case 2 "git push origin main"           "$(bash_cmd_json 'git push origin main')" || fail=1
  run_case 2 "git push HEAD:main"             "$(bash_cmd_json 'git push -u origin HEAD:main')" || fail=1
  run_case 2 "git push quoted ref"            "$(bash_cmd_json "git push origin 'HEAD:main'")" || fail=1
  run_case 2 "git -C dir push production"     "$(bash_cmd_json 'git -C ../fernhill-platform push origin HEAD:production')" || fail=1
  run_case 2 "git push refs/heads/production" "$(bash_cmd_json 'git push origin HEAD:refs/heads/production; echo done')" || fail=1
  run_case 2 "git push after &&"              "$(bash_cmd_json 'git fetch && git push origin production')" || fail=1
  run_case 2 "git push force main"            "$(bash_cmd_json 'git push --force origin +main')" || fail=1
  run_case 2 "gh workflow run (any)"          "$(bash_cmd_json 'gh workflow run 123456')" || fail=1
  run_case 2 "gh workflow run release"        "$(bash_cmd_json 'gh workflow run release.yml -f sha=abc')" || fail=1
  run_case 2 "dispatch via API"               "$(bash_cmd_json 'gh api -X POST repos/x/y/actions/workflows/release.yml/dispatches -f ref=main')" || fail=1
  run_case 2 "gh api approve deploy"          "$(bash_cmd_json 'gh api -X POST repos/x/y/actions/runs/1/pending_deployments')" || fail=1
  run_case 2 "gh api review APPROVE"          "$(bash_cmd_json 'gh api repos/x/y/pulls/1/reviews -f event=APPROVE')" || fail=1
  # allowed
  run_case 0 "git push feature branch"        "$(bash_cmd_json 'git push -u origin intent/0001-flow')" || fail=1
  run_case 0 "git push branch named maint"    "$(bash_cmd_json 'git push origin fix/maintenance-window')" || fail=1
  run_case 0 "gh pr create"                   "$(bash_cmd_json 'gh pr create --fill')" || fail=1
  run_case 0 "gh pr review --comment"         "$(bash_cmd_json 'gh pr review 12 --comment -b "looks fine"')" || fail=1
  run_case 0 "git checkout main"              "$(bash_cmd_json 'git checkout main && git pull')" || fail=1
  run_case 0 "gh run rerun (CI retry)"        "$(bash_cmd_json 'gh run rerun 123 --failed')" || fail=1
  # exceptions
  run_case 0 "merge under active exception"   "$(bash_cmd_json "gh pr merge 5 $ok --delete-branch")" || fail=1
  run_case 0 "merge with -R before number"    "$(bash_cmd_json "gh pr merge -R nictuck/fernhill-flow 5 $ok")" || fail=1
  run_case 2 "merge: id only in a comment"    "$(bash_cmd_json 'gh pr merge 5 --squash # EX-001')" || fail=1
  run_case 2 "merge: id not in --body"        "$(bash_cmd_json 'gh pr merge 5 --squash --subject EX-001')" || fail=1
  run_case 2 "merge --admin even w/ exception" "$(bash_cmd_json "gh pr merge 5 --admin $ok")" || fail=1
  run_case 2 "merge naming expired exception" "$(bash_cmd_json 'gh pr merge 5 --squash --body "Merged under EX-002"')" || fail=1
  run_case 2 "merge naming revoked exception" "$(bash_cmd_json 'gh pr merge 5 --squash --body "Merged under EX-003"')" || fail=1
  run_case 2 "merge naming wrong grant"       "$(bash_cmd_json 'gh pr merge 5 --squash --body "Merged under EX-004"')" || fail=1
  run_case 2 "merge: exception has no expiry" "$(bash_cmd_json 'gh pr merge 5 --squash --body "Merged under EX-005"')" || fail=1
  run_case 2 "merge naming unknown exception" "$(bash_cmd_json 'gh pr merge 5 --squash --body "Merged under EX-099"')" || fail=1
  run_case 2 "merge without a PR number"      "$(bash_cmd_json 'gh pr merge --squash --body "Merged under EX-001"')" || fail=1
  printf '.claude/settings.json\nsrc/a.ts\n' > "$files"
  run_case 2 "merge of a guardrail change"    "$(bash_cmd_json "gh pr merge 5 $ok")" || fail=1
  printf '.github/workflows/ci.yml\n' > "$files"
  run_case 2 "merge of a workflow change"     "$(bash_cmd_json "gh pr merge 5 $ok")" || fail=1
  printf 'src/a.ts\n' > "$files"
  HOOK_TEST_ARGS="--fixtures $tmp some-other-repo $files"
  run_case 2 "merge in a repo not listed"     "$(bash_cmd_json "gh pr merge 5 $ok")" || fail=1
  HOOK_TEST_ARGS="--fixtures $tmp fernhill-flow $files"
  run_case 2 "push main even with exception"  "$(bash_cmd_json 'git push origin main # EX-001')" || fail=1
  run_case 2 "approve even with exception"    "$(bash_cmd_json 'gh pr review 5 --approve -b EX-001')" || fail=1
  rm -rf "$tmp"
  exit $fail
fi

# ---- the gate -------------------------------------------------------------------------
input=$(hook_input)
[ "$(json_field "$input" '.tool_name')" = "Bash" ] || exit 0
cmd=$(json_field "$input" '.tool_input.command')
[ -n "$cmd" ] || exit 0

reason="Blocked by no-merge hook: the agent has no route to main or production. A human merges, approves and releases in GitHub (docs/flow.md, gates 4-5)."

check_segment() {
  local seg="$1" id
  # git push touching main or production, in any spelling
  if git_subcommand_is "$seg" push \
     && printf '%s' "$seg" | grep -Eq '(^|[[:space:]:/+])(main|production)([^A-Za-z0-9_./-]|$)'; then
    block "$reason"
  fi

  if invokes "$seg" gh; then
    # gh pr merge — only under a named, active exception that covers this PR
    if printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
      printf '%s' "$seg" | grep -Eq '(^|[[:space:]])--admin([[:space:]]|$)' && block "$reason (--admin bypasses the required checks; never allowed.)"
      id=$(printf '%s' "$seg" | grep -oE '(--body|-b)[[:space:]=]+.*EX-[0-9]{3}' | grep -oE 'EX-[0-9]{3}' | head -1 || true)
      if [ -n "$id" ] && exception_grants "$id" merge && exception_covers_pr "$id" "$seg"; then
        :
      else
        block "$reason If an exception in exceptions/ is active and grants merge, run /review first and name the id in the merge body: gh pr merge N --squash --body 'Merged under EX-001 after /review: …'. ${id:+($id is not active, has expired, does not grant merge, does not list this repo, or the PR changes guardrails — see the line above.)}"
      fi
    fi
    # approving is never delegated
    printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+review([[:space:]]|$).*--approve' && block "$reason"
    # starting workflow runs is a human act (release manager); reruns of CI are fine
    printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+workflow[[:space:]]+run([[:space:]]|$)' && block "$reason"
    printf '%s' "$seg" | grep -Eq 'actions/workflows/[^[:space:]]*/dispatches' && block "$reason"
    # API routes that approve reviews or pending deployments
    printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+api([[:space:]]|$).*pending_deployments' && block "$reason"
    printf '%s' "$seg" | grep -Eq 'gh[[:space:]]+api([[:space:]]|$).*/pulls/.*(APPROVE|/merge)' && block "$reason"
  fi
  return 0
}
for_each_segment "$cmd" check_segment

exit 0
