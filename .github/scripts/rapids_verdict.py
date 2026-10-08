#!/usr/bin/env python3
# Reads the verdict from logs because they aggregate across Knative revisions, unlike
# the HTTP endpoint. Prints succeeded, failed:<detail>, none or error; always exits 0.

import json
import re
import sys

# Narrow field patterns: Knative can wrap the line in JSON, and a greedy one would
# capture trailing `"}` into the state.
VERDICT = re.compile(
    r"\[migrate-entry\]\s+VERDICT\s+run=(?P<run>[A-Za-z0-9._\-]+)\s+state=(?P<state>[A-Za-z]+)(?P<rest>[^\"\\]*)"
)


def verdict(raw: str, run_id: str) -> str:
    try:
        payload = json.loads(raw)
    except Exception:
        return "error"

    if not isinstance(payload, dict) or payload.get("success") is False:
        return "error"

    data = payload.get("data")
    if not isinstance(data, dict):
        return "error"

    # An unreachable log backend is "cannot tell", never "no verdict yet".
    if data.get("available") is False:
        return "error"

    entries = data.get("entries")
    if not isinstance(entries, list):
        return "error"

    # Order is not guaranteed and a retried pod can log twice: failure wins.
    found = None
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        match = VERDICT.search(str(entry.get("message") or ""))
        if not match or match.group("run") != run_id:
            continue
        state = match.group("state")
        if state == "succeeded":
            found = found or "succeeded"
        else:
            detail = (state + " " + match.group("rest").strip()).strip()
            return f"failed:{detail}"
    return found or "none"


def main() -> int:
    if len(sys.argv) != 2:
        print("error")
        return 0
    print(verdict(sys.stdin.read(), sys.argv[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
