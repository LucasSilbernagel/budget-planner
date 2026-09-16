#!/usr/bin/env python3
"""List the image tags currently deployed to Rapids containers — one per line.

⚠️ THIS EXISTS BECAUSE THE SITE WENT DOWN. 2026-09-16, ~05:28 CEST.

The registry prune keeps only the newest N tags. On 2026-09-15 several deploy
attempts pushed tags in quick succession, which pushed the tag `budget-planner-web`
was actually RUNNING out of the keep-window, and the prune deleted it. A deployed
Knative revision is pinned to the exact image it was created from, so the container
kept serving until it scaled to zero — and then could not start again:
`manifest unknown`. The site was down until the container was redeployed onto a tag
that still existed.

The prune already refused to delete the tag the current run just pushed. Nobody had
taught it to spare the tag that is currently SERVING TRAFFIC. That is what this
answers.

Output is tags only — never a whole container row. `danube --json rapids ls`
includes `environment_variables` **with values** (verified against the live API),
so its output must never reach a log; this script is one of the few things that
should ever read it.

Exit status is meaningful here, unlike the other helpers in this directory:

    0  the listing was read and the tags below are complete
    1  the listing could not be read — the caller MUST NOT prune

"Could not tell which tags are live" and "no tags are live" must never look alike:
treating the first as the second is exactly how a live image gets deleted.

Usage:  danube --json rapids ls | rapids_deployed_tags.py
"""

import json
import sys


def deployed_tags(raw: str) -> list[str] | None:
    """Return the deployed tags, or None if the listing cannot be trusted."""
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
