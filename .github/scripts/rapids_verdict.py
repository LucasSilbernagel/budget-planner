#!/usr/bin/env python3
"""Extract THIS run's migration verdict from `danube --json rapids logs`.

Story 5.18, 2026-09-16. The second verdict channel, and the reason there are two.

The first channel is an HTTP endpoint on the migrate container. It is precise, but
it is reached through the container's public URL, and Knative routes that URL to
whatever revision is currently READY — which need not be the revision that ran the
migration. Live run 35042874267-1: revision `budget-planner-migrator-00001`
completed the migration, logged `succeeded`, and was replaced; every poll after
that got 401 from a successor holding a different token. The migration had worked.
The pipeline just could not reach the pod that knew it, and timed out.

Logs do not have that problem: they aggregate across revisions. So the container
also prints one machine-readable line per terminal outcome —

    [migrate-entry] VERDICT run=<run-id> state=succeeded
    [migrate-entry] VERDICT run=<run-id> state=failed step=<step> code=<code>

— and this reads it back. The run id is what makes a line attributable to THIS
release rather than a previous one: without it, yesterday's `succeeded` sitting in
the log window would be indistinguishable from today's.

Prints exactly one of:

    succeeded          this run reported success
    failed:<detail>    this run reported failure
    none               no verdict for this run yet (keep polling)
    error              the logs could not be read — NOT the same as "none"

and ALWAYS exits 0, so the caller branches on a value rather than an exit code.
`none` and `error` are deliberately different words: "not finished yet" and "I
cannot tell" must never collapse into one answer, because the first is worth
waiting on and the second is worth failing on.

Usage:  danube --json rapids logs <name> --since 1h --limit 500 | rapids_verdict.py <run-id>
"""

import json
import re
import sys

# Mirrors the line emitted by apps/web/migrate-entry.mjs `emitVerdict()`.
#
# ⚠️ The field patterns are deliberately NARROW, not `\S+`. Knative wraps some
# container output in its own JSON, so the sentinel can arrive embedded in a
# larger line — and `state=(\S+)` then captured `succeeded"}` including the
# trailing punctuation, which failed the equality check and reported a SUCCESSFUL
# migration as a failure. Caught by this script's own tests before it ever ran.
VERDICT = re.compile(
    r"\[migrate-entry\]\s+VERDICT\s+run=(?P<run>[A-Za-z0-9._\-]+)\s+state=(?P<state>[A-Za-z]+)(?P<rest>[^\"\\]*)"
)


def verdict(raw: str, run_id: str) -> str:
    """Return 'succeeded', 'failed:<detail>', 'none', or 'error'. Never raises."""
    try:
        payload = json.loads(raw)
    except Exception:
        return "error"

    if not isinstance(payload, dict) or payload.get("success") is False:
        return "error"

    data = payload.get("data")
    if not isinstance(data, dict):
        return "error"

    # The CLI reports this when its log backend is unreachable, and says in its own
    # words that it "says nothing about the container itself". Treating that as
    # "no verdict yet" would let a release time out believing it had looked.
    if data.get("available") is False:
        return "error"

    entries = data.get("entries")
    if not isinstance(entries, list):
        return "error"

    # Newest last is not guaranteed, so scan everything and prefer a terminal
    # answer. A run cannot be both, but a retried pod could log twice; failure
    # wins, because shipping on a success that was contradicted is the worse error.
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
