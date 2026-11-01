#!/usr/bin/env bash
# Shared helpers for Fernhill hooks. Source, don't execute.
#
# Hooks read one JSON object on stdin (Claude Code PreToolUse/PostToolUse
# payload) and exit 0 to allow or 2 to block; stderr on exit 2 is shown to
# the agent. Every hook supports `--test` to self-check with sample input.
#
# Hooks are an honest-agent control: they run on the agent's machine. The
# deterministic backstop is GitHub itself (branch protection, rulesets,
# environment reviewers). Hooks exist so the agent is stopped before it
# tries, with a reason it can act on.

hook_input() { cat; }

json_field() { # json_field <json> <jq path>
  printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null
}

block() { # block <message>
  printf '%s\n' "$1" >&2
  exit 2
}

# Normalize a shell command for matching: drop quotes, then split on ; | &
# so each simple command sits on its own line.
command_segments() { # command_segments <command>  (always ends with a newline)
  printf '%s\n' "$1" | tr -d "\"'" | tr ';|&' '\n\n\n' | sed -E 's/^[[:space:]]+//'
}

# for_each_segment <command> <callback>: callback gets each non-empty segment
for_each_segment() {
  local seg
  while IFS= read -r seg || [ -n "$seg" ]; do
    [ -n "$seg" ] || continue
    "$2" "$seg"
  done < <(command_segments "$1")
}

invokes() { # invokes <segment> <program>  (by basename, any path)
  printf '%s' "$1" | grep -Eq "(^|[[:space:]]|/)$2([[:space:]]|$)"
}

# git may carry global options between `git` and the subcommand (git -C dir push)
git_subcommand_is() { # git_subcommand_is <segment> <subcommand>
  printf '%s' "$1" | grep -Eq "(^|[[:space:]]|/)git[[:space:]]+(-[^[:space:]]+[[:space:]]+([^[:space:]-][^[:space:]]*[[:space:]]+)?)*$2([[:space:]]|$)"
}

# run_case <expected exit> <description> <json> — used by --test.
# HOOK_TEST_ARGS (set only inside a hook's --test block) is passed as argv so
# fixtures never travel through the environment of a real session.
run_case() {
  local want="$1" desc="$2" json="$3" got
  # shellcheck disable=SC2086
  printf '%s' "$json" | "$0" ${HOOK_TEST_ARGS:-} >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    printf '  ok   %s\n' "$desc"
  else
    printf '  FAIL %s (exit %s, wanted %s)\n' "$desc" "$got" "$want"
    return 1
  fi
}

bash_cmd_json() { # bash_cmd_json <command string>
  jq -cn --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'
}

edit_json() { # edit_json <file path>
  jq -cn --arg p "$1" '{tool_name:"Edit",tool_input:{file_path:$p}}'
}
