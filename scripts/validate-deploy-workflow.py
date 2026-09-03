#!/usr/bin/env python3
"""Structural invariants for the production deploy pipeline (Story 5-4).

`actionlint` checks GitHub Actions *syntax*. This checks the things that make
the pipeline SAFE, which syntax cannot express: that a red build structurally
cannot deploy, that secrets never reach a `run:` script, that the migration is
gated before it can touch production, and that no job can silently lose access
to the secrets it needs.

This file exists because story 5-4's review found that those invariants had only
ever been asserted in an ephemeral shell session — an unverifiable claim in a
story record. Now they are re-runnable:

    python3 scripts/validate-deploy-workflow.py

Requires PyYAML (preinstalled on ubuntu-latest runners and most dev boxes).
Exits non-zero on any violation, so it can be wired into CI if wanted.
"""

from __future__ import annotations

import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    print("SKIP: PyYAML not installed (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

CI = ".github/workflows/ci.yml"
DEPLOY = ".github/workflows/deploy.yml"

failures: list[str] = []
checked = 0


def check(condition: object, label: str) -> None:
    global checked
    checked += 1
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def triggers(doc: dict) -> dict:
    """`on:` parses to the boolean True under YAML 1.1 ("the Norway problem")."""
    return doc.get("on", doc.get(True))


def needs_of(jobs: dict, name: str) -> list[str]:
    value = jobs[name].get("needs", [])
    return [value] if isinstance(value, str) else value


def main() -> int:
    ci, deploy = load(CI), load(DEPLOY)
    jobs = deploy["jobs"]
    raw = open(DEPLOY, encoding="utf-8").read()

    print("\n== ci.yml: story 4-15's contract is preserved ==")
    check(set(ci["jobs"]) == {"lint", "unit-tests", "e2e-tests"}, "the three gate jobs are unchanged")
    check("pull_request" in triggers(ci) and "push" in triggers(ci), "original triggers intact")
    check("workflow_call" in triggers(ci), "workflow_call exposed for the deploy gate")

    print("\n== a red build structurally cannot deploy ==")
    check(jobs["quality-gates"].get("uses") == "./.github/workflows/ci.yml", "gates reuse ci.yml")
    reachable: set[str] = set()

    def walk(name: str) -> None:
        for dep in needs_of(jobs, name):
            if dep not in reachable:
                reachable.add(dep)
                walk(dep)

    walk("deploy")
    check("quality-gates" in reachable, "deploy transitively needs the quality gates")
    check("type-check" in reachable, "deploy transitively needs the type-check")
    check(needs_of(jobs, "deploy") == ["migrate"], "deploy needs migrate (schema precedes code)")
    check(needs_of(jobs, "smoke") == ["deploy"], "smoke needs deploy")

    print("\n== the type-check gate uses live scripts, not the dead tsc:* ones ==")
    runs = [step.get("run", "") for step in jobs["type-check"]["steps"]]
    check(sum("type-check" in run for run in runs) == 4, "four per-package type-check steps")
    check(not any("tsc:" in run for run in runs), "never invokes the dead tsc:* scripts")

    print("\n== migration is ordered, abortive, and gated ==")
    steps = jobs["migrate"]["steps"]
    pre = next(i for i, s in enumerate(steps) if "db:migrate:preflight" in s.get("run", ""))
    mig = next(i for i, s in enumerate(steps) if s.get("run", "").strip().endswith("db:migrate"))
    check(pre < mig, "preflight runs before db:migrate")
    check(not any(s.get("continue-on-error") for s in steps), "no continue-on-error in migrate")
    check(jobs["migrate"].get("environment") == "production", "migrate sits in the production environment")

    print("\n== secrets are referenced, never inlined ==")
    for name, job in jobs.items():
        for step in job.get("steps", []) or []:
            check("secrets." not in (step.get("run", "") or ""),
                  f"no secret interpolated into a run: script ({name}/{step.get('name')})")
    check(not re.search(r"echo\s+\"?\$\{?\{?\s*secrets", raw), "no step echoes a secret")

    print("\n== every job that uses environment secrets declares the environment ==")
    # Regression guard: `build-image` once read `production` Environment secrets
    # without an `environment:` key, so they resolved to EMPTY and `docker login`
    # ran with blank credentials. Found in code review 2026-09-03.
    for name, job in jobs.items():
        block = yaml.safe_dump(job)
        if re.search(r"secrets\.DANUBEDATA_REGISTRY|secrets\.DATABASE_URL|secrets\.RAPIDS_API_TOKEN", block):
            check(job.get("environment") is not None,
                  f"{name} declares an environment for its scoped secrets")

    print("\n== least privilege, timeouts, and branch confinement ==")
    check(deploy["permissions"] == {"contents": "read"}, "workflow-level permissions are read-only")
    check(not any("permissions" in job for job in jobs.values()), "no job widens permissions")
    for name, job in jobs.items():
        if "uses" not in job:
            check("timeout-minutes" in job, f"{name} has a timeout (a hung job queues every later deploy)")
    for name in ("migrate", "deploy", "smoke"):
        condition = str(jobs[name].get("if"))
        check("vars.DEPLOY_ENABLED == 'true'" in condition, f"{name} is gated on DEPLOY_ENABLED")
        check("refs/heads/main" in condition, f"{name} cannot run off main, even via dispatch")

    print("\n== the pipeline cannot silently claim success ==")
    check(deploy["concurrency"]["cancel-in-progress"] is False, "an in-flight deploy is never cancelled")
    check(jobs["summary"]["if"] == "${{ always() }}", "the summary always runs")
    check(set(jobs["summary"]["needs"]) == set(jobs) - {"summary"}, "the summary observes every job")
    body = jobs["summary"]["steps"][0]["run"]
    check("THE BUILD IS BROKEN" in body, "a failed gate outranks the 'deploys are off' banner")
    check("which is NOT" in body, "a DEPLOY_ENABLED typo is reported, not treated as 'off'")
    deploy_step = next(s for s in jobs["deploy"]["steps"] if s["name"] == "Deploy revision to Rapids")
    check("exit 1" in deploy_step["run"], "the unwired deploy step fails loudly rather than no-opping")

    print(f"\n{checked - len(failures)}/{checked} invariants hold.")
    if failures:
        print("\nVIOLATIONS:")
        for item in failures:
            print(f"  - {item}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
