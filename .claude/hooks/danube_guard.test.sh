#!/usr/bin/env bash
# Verifies the credential guard's logic in isolation.
# It ONLY pipes synthetic JSON into the hook script. It never executes `danube`.
#
# A DENY verdict requires exit 2 AND the BLOCKED marker on stderr. The earlier
# version accepted bare exit 2, which is also what bash returns for a SYNTAX
# ERROR - so a guard that never ran scored 18 passing denials.
cd /home/lucassilbernagel/Documents/coding/side-projects/budget-planner
H=.claude/hooks/block-credential-printing.sh

# Assemble the sensitive literals from parts so this file's own text does not
# trip the guard under test.
G="db ge""t"
S="db sho""w"
C="db credential""s"
I="db connection-inf""o"

pass=0; fail=0

echo "== the script must be syntactically valid (this was the real bug) =="
if bash -n "$H" 2>/dev/null && python3 -m py_compile .claude/hooks/danube_guard.py 2>/dev/null; then
  echo "  ok   both files parse"; pass=$((pass+1))
else
  echo "  FAIL a file does not parse"; fail=$((fail+1))
fi

probe() { # probe <expected DENY|ALLOW> <label> <command> [PATH]
  local want="$1" label="$2" cmd="$3" envpath="${4:-}" err rc got
  err=$(mktemp)
  if [[ -n $envpath ]]; then
    printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.stdin.read()}}))' | PATH="$envpath" bash "$H" >/dev/null 2>"$err"
  else
    printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.stdin.read()}}))' | bash "$H" >/dev/null 2>"$err"
  fi
  rc=$?
  if [[ $rc -eq 2 ]] && grep -q '^BLOCKED:' "$err"; then got=DENY
  elif [[ $rc -eq 0 ]]; then got=ALLOW
  else got="ERROR(rc=$rc)"; fi
  rm -f "$err"
  if [[ $got == "$want" ]]; then pass=$((pass+1)); printf '  ok   %-6s %s\n' "$got" "$label"
  else fail=$((fail+1)); printf '  FAIL want=%s got=%s  %s\n' "$want" "$got" "$label"; fi
}

echo "== must DENY: the forms that BYPASSED the old hook =="
probe DENY 'subshell capture'        "CONN=\$(danube $G)"
probe DENY 'pipe'                    "danube $G | jq ."
probe DENY 'semicolon'               "danube $G;true"
probe DENY 'redirect'                "danube $G>creds.txt"
probe DENY 'bash -c quoted'          "bash -c \"danube $G\""
probe DENY 'flag=value project'      "danube --project=budgetplanner795 $G"
probe DENY 'flag=value json'         "danube --json=true $G"
probe DENY 'backslash-newline'       "danube \\
$G"
probe DENY 'backtick capture'        "X=\`danube $G\`"

echo "== must DENY: enumeration gap the old deny-list missed =="
probe DENY 'db connection-info'      "danube $I"
probe DENY 'unknown future subcmd'   "danube db dump-secrets"
probe DENY 'write op'                "danube db create --name x"

echo "== must DENY: previously-covered forms (no regression) =="
probe DENY 'bare get'                "danube $G"
probe DENY 'global --json'           "danube --json $G"
probe DENY 'show'                    "danube $S"
probe DENY 'credentials'             "danube $C"
probe DENY 'chained, blocked last'   "danube db ls && danube $G"
probe DENY 'chained, blocked first'  "danube $G && danube db ls"

echo "== must ALLOW: read-only work must keep working =="
probe ALLOW 'db ls'                  "danube db ls"
probe ALLOW 'rapids ls'              "danube rapids ls"
probe ALLOW 'db events'              "danube db events"
probe ALLOW 'db metrics'             "danube db metrics"
probe ALLOW 'whoami'                 "danube whoami"
probe ALLOW 'bare danube'            "danube"
probe ALLOW 'help flag'              "danube --help"
probe ALLOW 'project flag + ls'      "danube --project x db ls"
probe ALLOW 'flag=value + ls'        "danube --project=x db ls"
probe ALLOW 'ls chained'             "danube db ls && echo done"
probe ALLOW 'unrelated command'      "git status"
probe ALLOW 'unrelated w/ substring' "echo danubedata-notes.txt"
probe ALLOW 'hostname in a string'   "psql budget-planner-prod-rw.danubedata.ro"

echo "== fail-closed: decider unavailable =="
mkdir -p /tmp/nopy-bin
for b in bash sed grep printf cat head mktemp rm; do
  src=$(command -v "$b") && ln -sf "$src" "/tmp/nopy-bin/$b" 2>/dev/null
done
probe DENY  'no python3 + danube'     "danube $G"   "/tmp/nopy-bin"
probe ALLOW 'no python3, no danube'   "git status"  "/tmp/nopy-bin"

echo
echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
