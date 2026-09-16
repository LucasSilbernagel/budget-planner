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
# `available-metrics` lists the metric TYPES alertable on a resource KIND (not an
# instance), so it reaches no credential; it is how story 5-6 established that
# DanubeData registers no evaluator for database/cache/app, and a future session
# needs it to re-check whether that has changed.
SAFE_VERBS = {"ls", "list", "events", "metrics", "available-metrics"}
# Top-level subcommands that take no resource and print nothing sensitive.
SAFE_TOP = {"whoami", "help", "version", "completion", "docs"}
# Resources whose every verb is safe, because they never hold a connection
# secret. Story 5-6 needed `uptime create` to provision the AC-5 monitoring, and
# the verb-level allow-list cannot express that: adding "create" to SAFE_VERBS
# would also unblock `danube db create`, which prints the new instance's admin
# password. Scoping by RESOURCE keeps every credential-bearing resource (db,
# vps, cache, queue, apps, storage, registry, rapids) fully guarded.
#
# `alerts`/`metric-alerts` were in this set briefly and were REMOVED after
# review: metric alerts have no evaluator for any resource kind this project
# uses, so one must never be created here, which left the entries buying
# nothing while keeping an `alerts get` surface. `alerts ls` and
# `alerts available-metrics` still work via SAFE_VERBS.
#
# WARNING: the residual exposure is `uptime create --url <url>`, which accepts
# any URL. A check created against `https://user:pass@host/...` or a `?token=`
# URL has those credentials echoed back by `uptime get`, `uptime ls` and
# `uptime diagnose`, all allowed here. Probe only unauthenticated endpoints.
SAFE_RESOURCES = {"uptime", "uptime-checks"}
# Global flags KNOWN to take no value. Any other flag seen before the first
# positional is assumed to consume the next token (see offending_invocation) —
# fail-closed, because an unknown value-taking flag would otherwise make its
# value look like the subcommand and hand an attacker a free pass.
GLOBAL_BOOLEAN_FLAGS = {
    "--json",
    "--help",
    "-h",
    "--version",
    "-V",
    "--debug",
    "--verbose",
    "--quiet",
    "--no-color",
}
# Global flags that consume the following token, so it is not the subcommand.
VALUE_FLAGS = {"--project", "--team", "--namespace", "-p", "-n"}

REASON = """DanubeData prints live credentials into the transcript for most non-read
subcommands, and offers no credential rotation - a leak forces deleting and
re-provisioning the instance.

Allowed here: the read-only verbs ls / list / events / metrics /
available-metrics on any resource; the top-level whoami / help / version; and
every verb on the monitoring resources uptime / uptime-checks.

If you need a value that only a blocked subcommand prints, read it from the
DanubeData dashboard rather than through any tool that records output. Do NOT
re-run this via `!` - that prints the same secret into the same transcript.

If a blocked subcommand is genuinely safe and needed often, add it to
SAFE_VERBS / SAFE_TOP / SAFE_RESOURCES in .claude/hooks/danube_guard.py as a
deliberate, reviewed change. See docs/production-database-runbook.md."""


# A command may begin at the string start or after a shell metacharacter.
_CMD_START = r"""(?:^|[;|&()`{}'"\s]|\$\()\s*"""
# The binary, with an optional directory prefix (absolute, ~, or relative) and an
# optional backslash escape. The lookahead keeps `danubedata.ro` from matching.
_BINARY = r"""(?:[^\s;|&()`'"]*/)?\\?danube(?![\w.\-/])"""
# `npx @danubedata/cli ...` / `pnpm dlx @danubedata/cli@1.3.0 ...` run the same
# CLI without ever spelling the bare binary name.
_PACKAGE = r"""@danubedata/cli(?:@[\w.\-]+)?(?![\w.\-])"""
_INVOCATION_RE = _CMD_START + r"(?:" + _BINARY + r"|" + _PACKAGE + r")"
# Shell redirection tokens: optional fd, then < or >, then anything.
_REDIRECT_RE = re.compile(r"^\d*[<>]")


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
    #
    # The optional PATH PREFIX and the package alternative below close a hole
    # found by code review 2026-09-16: the bare-name pattern matched none of
    # `/home/u/.local/share/pnpm/bin/danube db get`, `~/bin/danube db get`,
    # `./bin/danube db get`, `\danube db get`, `npx @danubedata/cli db get` or
    # `pnpm dlx @danubedata/cli db get` - every one of which ran the real CLI
    # and printed the live admin password. `command -v danube` returns an
    # absolute path, so the path-prefixed form is the NORMAL way to invoke it,
    # not an exotic one.
    for match in re.finditer(_INVOCATION_RE, cmd):
        rest = cmd[match.end():]
        # Stop at the end of this command; a later one gets its own match.
        rest = re.split(r"[;|&)`}]|\$\(", rest, maxsplit=1)[0]
        tokens = [t for t in rest.strip().split(" ") if t]

        positional = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if _REDIRECT_RE.match(token):
                # `2>`, `>out`, `1>&2` - shell plumbing, never a subcommand.
                # Without this, `danube --help 2>&1` split to a `2>` positional
                # and was wrongly DENIED.
                pass
            elif token.startswith("-"):
                # --project=x is self-contained; --project x eats the next token.
                if "=" not in token:
                    if token in VALUE_FLAGS:
                        index += 1
                    elif not positional and token not in GLOBAL_BOOLEAN_FLAGS:
                        # An UNKNOWN global flag before the subcommand: assume it
                        # takes a value, so its value cannot masquerade as the
                        # subcommand. Fail-closed - `danube --output uptime db
                        # get` otherwise read as the allowed resource `uptime`
                        # while the CLI ran `db get`.
                        index += 1
            else:
                positional.append(token.strip("\"'"))
            index += 1

        if not positional:
            continue  # bare `danube`, or flags only - prints help
        if positional[0] in SAFE_TOP:
            continue
        if positional[0] in SAFE_RESOURCES:
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

    # A non-string `command` (list, int, None) would otherwise raise below and
    # exit 1 - and PreToolUse treats any code but 2 as NON-blocking, so the call
    # would proceed. Decide on its text form instead, fail-closed. Found by code
    # review 2026-09-16.
    if command is not None and not isinstance(command, str):
        rendered = repr(command)
        if "danube" in rendered:
            block("the payload's `command` is {}, not a string, and it mentions "
                  "`danube`.".format(type(command).__name__))
        sys.exit(0)

    if not command or "danube" not in command:
        sys.exit(0)

    offender = offending_invocation(command)
    if offender:
        block("`danube {}` is not on the read-only allow-list.".format(offender))
    sys.exit(0)


if __name__ == "__main__":
    main()
