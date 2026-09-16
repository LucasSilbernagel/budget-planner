#!/usr/bin/env python3
"""Answer "are these env vars gone from this container?" without ever printing a value.

Story 5.18, 2026-09-16. The migrate container is now PERMANENT and scaled to zero
between runs, instead of being created and deleted each time — deleting it left
orphaned config in DanubeData's GitOps repo and broke the next provision (two runs
lost to it). The property that deletion used to give us, "no credentials sitting
around", is now provided by stripping the env with `rapids update --rm-env`.

That makes "the strip actually took" a safety property, so it is verified rather
than assumed — and verified the same fail-closed way the presence check is: this
prints one of `clean`, `dirty:<KEYS>`, `error` and ALWAYS exits 0, so "the keys are
gone" can never be confused with "we could not tell".

⚠️ `danube --json rapids ls` includes `environment_variables` with FULL VALUES —
confirmed against the live API. That output must never reach a log. This script is
the only thing that should ever read it: it emits key NAMES at most, never values.

Usage:  danube --json rapids ls | rapids_env_check.py <container> <KEY> [KEY...]
"""

import json
import sys


def check(raw: str, name: str, keys: list[str]) -> str:
    """Return 'clean', 'dirty:K1,K2', or 'error'. Never raises, never echoes a value."""
    try:
        payload = json.loads(raw)
    except Exception:
        return "error"

    if not isinstance(payload, dict) or payload.get("success") is False:
        return "error"

    rows = payload.get("data")
    if not isinstance(rows, list):
        return "error"

    row = next((r for r in rows if isinstance(r, dict) and r.get("name") == name), None)
    if row is None:
        # The container is not listed at all. For this check that IS clean — a
        # container that does not exist is holding nothing.
        return "clean"

    env = row.get("environment_variables")
    if env is None:
        return "clean"
    if not isinstance(env, dict):
        # Present but unreadable: we cannot prove the keys are gone, so we do not
        # claim it.
        return "error"

    remaining = sorted(k for k in keys if k in env)
    return f"dirty:{','.join(remaining)}" if remaining else "clean"


def main() -> int:
    if len(sys.argv) < 3:
        print("error")
        return 0
    print(check(sys.stdin.read(), sys.argv[1], sys.argv[2:]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
