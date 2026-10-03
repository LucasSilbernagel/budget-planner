#!/usr/bin/env python3
"""Print the registry's tag list as `tag  bytes_size  pushed_at` (story ops-1, AC-1).

    danube --json registry repos tags "$REPO" | python3 .github/scripts/registry_tags_table.py <label>

The push job runs this before the prune, after the prune and after the push, so
every run's log shows exactly how the 500 MB quota is being spent: per tag, at
the size the registry itself bills (`bytes_size`), and the sum.

Only those three fields are printed — never the digest or anything else from a
row, and this helper is never fed a `rapids` listing (those rows carry container
env values, i.e. credentials).

The CLI's `--json` mode double-wraps the server payload (`.data.data`, see the
prune step in deploy.yml); a bare list under `.data` is accepted too. Any other
shape prints a warning and exits 0: this is a report, and a report must never
fail a deploy.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    label = sys.argv[1] if len(sys.argv) > 1 else "now"
    try:
        envelope = json.load(sys.stdin)
    except ValueError as error:
        print(f"::warning::registry tag listing ({label}) was not JSON: {error}")
        return 0
    inner = envelope.get("data") if isinstance(envelope, dict) else None
    rows = inner.get("data") if isinstance(inner, dict) else inner
    if not isinstance(rows, list):
        print(f"::warning::registry tag listing ({label}) had an unexpected shape; no table")
        return 0

    rows = sorted(rows, key=lambda r: str(r.get("pushed_at") or ""), reverse=True)
    total = 0
    print(f"Registry tags {label} (newest first):")
    print(f"  {'tag':<42}  {'bytes_size':>12}  pushed_at")
    for row in rows:
        size = row.get("bytes_size")
        if isinstance(size, (int, float)):
            total += int(size)
        print(f"  {str(row.get('tag')):<42}  {str(size):>12}  {row.get('pushed_at')}")
    print(f"  {len(rows)} tags, sum of bytes_size = {total:,} B = {total / 1e6:.1f} MB = {total / 2**20:.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
