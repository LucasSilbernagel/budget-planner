#!/usr/bin/env python3
# A report only: any unexpected shape warns and exits 0. Never feed it a `rapids`
# listing (those rows carry container env values).

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
