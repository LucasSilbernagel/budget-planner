#!/usr/bin/env python3
# PreToolUse hook: exit 0 allows, exit 2 blocks with the reason on stderr.

import json
import re
import sys

SAFE_VERBS = {"ls", "list", "events", "metrics", "available-metrics"}
SAFE_TOP = {"whoami", "help", "version", "completion", "docs"}
# Every verb on these is safe: they hold no connection secret. Caveat: `uptime create`
# echoes back any credentials embedded in its URL, so probe only unauthenticated URLs.
SAFE_RESOURCES = {"uptime", "uptime-checks"}
# Unknown flags before the first positional are assumed to take a value (fail-closed).
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


_CMD_START = r"""(?:^|[;|&()`{}'"\s]|\$\()\s*"""
# The lookahead keeps `danubedata.ro` from matching.
_BINARY = r"""(?:[^\s;|&()`'"]*/)?\\?danube(?![\w.\-/])"""
_PACKAGE = r"""@danubedata/cli(?:@[\w.\-]+)?(?![\w.\-])"""
_INVOCATION_RE = _CMD_START + r"(?:" + _BINARY + r"|" + _PACKAGE + r")"
_REDIRECT_RE = re.compile(r"^\d*[<>]")


def block(what: str) -> None:
    sys.stderr.write("BLOCKED: {}\n\n{}\n".format(what, REASON))
    sys.exit(2)


def offending_invocation(cmd: str):
    cmd = cmd.replace("\\\n", " ")
    cmd = re.sub(r"\s+", " ", cmd)

    # Quotes count as command starts: `bash -c "danube db get"`. Path-prefixed and
    # package-runner forms are normal invocations (`command -v` returns a path).
    for match in re.finditer(_INVOCATION_RE, cmd):
        rest = cmd[match.end():]
        rest = re.split(r"[;|&)`}]|\$\(", rest, maxsplit=1)[0]
        tokens = [t for t in rest.strip().split(" ") if t]

        positional = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if _REDIRECT_RE.match(token):
                # `2>`, `>out`, `1>&2` - shell plumbing, never a subcommand.
                pass
            elif token.startswith("-"):
                # --project=x is self-contained; --project x eats the next token.
                if "=" not in token:
                    if token in VALUE_FLAGS:
                        index += 1
                    elif not positional and token not in GLOBAL_BOOLEAN_FLAGS:
                        # Unknown global flag: assume it takes a value, so its
                        # value cannot masquerade as an allowed subcommand.
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
        # Unparseable payload: block only if it mentions danube.
        if "danube" in raw:
            block("cannot parse the hook payload, and it mentions `danube`.")
        sys.exit(0)

    # PreToolUse treats any exit but 2 as non-blocking, so a non-string command
    # must be decided here rather than allowed to raise.
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
