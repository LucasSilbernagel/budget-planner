#!/usr/bin/env python3
# Exit 1 when the listing is unreadable: the caller must then skip pruning, since
# "could not tell" must never look like "nothing is deployed".

import json
import sys


def deployed_tags(raw: str) -> list[str] | None:
    try:
        payload = json.loads(raw)
    except Exception:
        return None

    if not isinstance(payload, dict) or payload.get("success") is False:
        return None

    rows = payload.get("data")
    if not isinstance(rows, list):
        return None

    tags = []
    for row in rows:
        if not isinstance(row, dict):
            # A row we cannot read might be the container holding the live tag.
            return None
        tag = row.get("image_tag")
        if isinstance(tag, str) and tag.strip():
            tags.append(tag.strip())
    return tags


def main() -> int:
    tags = deployed_tags(sys.stdin.read())
    if tags is None:
        print("could not read the Rapids listing", file=sys.stderr)
        return 1
    for tag in sorted(set(tags)):
        print(tag)
    return 0


if __name__ == "__main__":
    sys.exit(main())
