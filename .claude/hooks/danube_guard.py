#!/usr/bin/env python3
"""Decide whether a Bash command contains a non-read-only `danube` invocation.

Reads the PreToolUse hook payload on stdin. Exits 0 to allow, 2 to block (with
the reason on stderr) — the exit-code protocol, so no JSON encoder is needed on
the deny path.

Lives as a real .py file rather than inline in the shell wrapper because the
first attempt embedded this logic in a $(...) heredoc and a backtick inside the
regex character class produced a bash syntax error. Bash exits 2 on a parse
error, which is also the "block" code, so a crashed guard was indistinguishable
from a working one — the test suite scored 18 passing denials against a script
that never ran.
"""

import json
import re
import sys

# Read-only verbs. `danube <resource> <verb>` is allowed when the verb is here.
SAFE_VERBS = {"ls", "list", "events", "metrics"}
# Top-level subcommands that take no resource and print nothing sensitive.
SAFE_TOP = {"whoami", "help", "version", "completion", "docs"}
# Global flags that consume the following token, so it is not the subcommand.
VALUE_FLAGS = {"--project", "--team", "--namespace", "-p", "-n"}

REASON = """DanubeData prints live credentials into the transcript for most non-read
subcommands, and offers no credential rotation - a leak forces deleting and
re-provisioning the instance.

Allowed here: ls / list, events, metrics, whoami, help, version.

If you need a value that only a blocked subcommand prints, read it from the
DanubeData dashboard rather than through any tool that records output. Do NOT
re-run this via `!` - that prints the same secret into the same transcript.

If a blocked subcommand is genuinely safe and needed often, add it to
SAFE_VERBS/SAFE_TOP in .claude/hooks/danube_guard.py as a deliberate, reviewed
change. See docs/production-database-runbook.md."""


def block(what: str) -> None:
    sys.stderr.write("BLOCKED: {}\n\n{}\n".format(what, REASON))
    sys.exit(2)


def offending_invocation(cmd: str):
    """Return the first `danube` invocation that is not on the allow-list."""
    # Fold line continuations and collapse whitespace so a multi-line or oddly
    # spaced command normalises to the same token stream.
    cmd = cmd.replace("\\\n", " ")
    cmd = re.sub(r"\s+", " ", cmd)

    # Match `danube` only in command position: at the start, or after a shell
    # metacharacter that can begin a new command. Quotes are included because
    # `bash -c "danube db get"` puts the invocation directly after a quote -
    # verified as a live bypass when they were omitted. The trailing lookahead
    # stops `danubedata.ro` from matching. The previous shell version anchored on
    # a TRAILING [[:space:]]|$ instead, which missed $(danube db get), pipes,
    # semicolons and redirects.
    for match in re.finditer(r"""(?:^|[;|&()`{}'"\s]|\$\()\s*danube(?![\w.\-/])""", cmd):
        rest = cmd[match.end():]
        # Stop at the end of this command; a later one gets its own match.
        rest = re.split(r"[;|&)`}]|\$\(", rest, maxsplit=1)[0]
        tokens = [t for t in rest.strip().split(" ") if t]

        positional = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.startswith("-"):
                # --project=x is self-contained; --project x eats the next token.
                if "=" not in token and token in VALUE_FLAGS:
                    index += 1
            else:
                positional.append(token.strip("\"'"))
            index += 1

        if not positional:
            continue  # bare `danube`, or flags only - prints help
        if positional[0] in SAFE_TOP:
            continue
        if len(positional) >= 2 and positional[1] in SAFE_VERBS:
            continue
        return " ".join(positional[:2])
    return None


def main() -> None:
    raw = sys.stdin.read()
    try:
        command = json.loads(raw).get("tool_input", {}).get("command", "")
    except Exception:
        # Cannot read the command. Decide on the raw payload rather than
        # assuming the best: text that never mentions danube is certainly not a
        # danube call; text that does is blocked. Keeps the failure closed on
        # exactly the risky case without breaking every other Bash call.
        if "danube" in raw:
            block("cannot parse the hook payload, and it mentions `danube`.")
        sys.exit(0)

    if not command or "danube" not in command:
        sys.exit(0)

    offender = offending_invocation(command)
    if offender:
        block("`danube {}` is not on the read-only allow-list.".format(offender))
    sys.exit(0)


if __name__ == "__main__":
    main()
