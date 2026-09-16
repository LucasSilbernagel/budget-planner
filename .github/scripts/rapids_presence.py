#!/usr/bin/env python3
"""Answer "is this Rapids container listed?" with a THREE-state word, never an exit code.

Story 5.18, code review 2026-09-15 (HIGH, found independently by two review layers).

The teardown step this replaces piped `danube --json rapids ls` into an inline
`python3 -c` that called `sys.exit(0 if present else 1)`. That conflates two
different answers:

    exit 1  ->  "the container is absent"          (good: deletion took)
    exit 1  ->  "json.load raised / ls failed"     (bad: we have NO IDEA)

so an API 502, an expired token, or any non-JSON output read as "absent". The step
then printed "Migrate container removed" and exited 0 while a publicly routable
container holding DATABASE_URL was still alive — the precise opposite of the
guarantee its own comment made.

This prints exactly one of `present`, `absent`, `error` and ALWAYS exits 0, so the
caller branches on a value it can actually distinguish and fails closed on `error`.
Nothing about the container rows is echoed: the rows carry `environment_variables`.

Usage:  danube --json rapids ls | rapids_presence.py <container-name>
"""

import json
import sys


def presence(raw: str, name: str) -> str:
    """Return 'present', 'absent', or 'error'. Never raises."""
    try:
        payload = json.loads(raw)
    except Exception:
        return "error"

    if not isinstance(payload, dict):
        return "error"

    # `data` is null on a structured CLI failure, and the envelope carries the
    # real story in `success`. Treat any non-list as unreadable rather than empty:
    # "no rows" and "could not read the rows" must not look alike, which is the
    # whole point of this file.
    rows = payload.get("data")
    if not isinstance(rows, list):
        return "error"

    if payload.get("success") is False:
        return "error"

    for row in rows:
        if isinstance(row, dict) and row.get("name") == name:
            return "present"
    return "absent"


def main() -> int:
    if len(sys.argv) != 2:
        print("error")
        return 0
    print(presence(sys.stdin.read(), sys.argv[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
