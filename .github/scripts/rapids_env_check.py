#!/usr/bin/env python3
# Prints clean, dirty:<KEYS> or error and always exits 0, so "keys gone" cannot be
# confused with "could not tell". The listing carries secret values: emit key names only.

import json
import sys


def check(raw: str, name: str, keys: list[str]) -> str:
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
        return "clean"

    env = row.get("environment_variables")
    if env is None:
        return "clean"
    if not isinstance(env, dict):
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
