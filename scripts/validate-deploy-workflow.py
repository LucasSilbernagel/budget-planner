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


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


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
        if re.search(r"secrets\.DANUBEDATA_REGISTRY|secrets\.DATABASE_URL|secrets\.DANUBE_TOKEN", block):
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
    print("\n== the Rapids rollout is real, authenticated, and cannot be raced ==")
    # Story 4-16 replaced the `exit 1` placeholder with the actual rollout. These
    # pin the properties that placeholder's own comment demanded, plus the ones
    # discovered by reading the CLI's source (@danubedata/cli 1.1.0) rather than
    # guessing at its interface.
    deploy_steps = jobs["deploy"]["steps"]
    deploy_step = next(s for s in deploy_steps if s["name"] == "Deploy revision to Rapids")
    rollout = deploy_step["run"]

    check("danube rapids apply" in rollout, "the deploy step performs a real Rapids rollout")
    check("exit 1" not in rollout, "the deploy step is no longer the unwired placeholder")
    check("set -euo pipefail" in rollout, "the rollout keeps strict bash")

    # `apply` returns as soon as the API accepts the desired state. Without
    # --wait the step exits 0 while the revision is still rolling out, and the
    # smoke job then measures the OLD revision: a green deploy of nothing.
    # ⚠️ `"--wait" in rollout` was the first spelling of this and it is VACUOUS:
    # `--wait-timeout` contains it as a substring, so the check passed even with
    # the standalone flag deleted. Caught by its own positive control. The
    # lookahead requires --wait to end as its own flag.
    check(re.search(r"--wait(?![\w-])", rollout),
          "the rollout blocks until the revision is terminal")
    check("--wait-timeout" in rollout, "the wait has an explicit ceiling")

    # The CLI reads DANUBE_TOKEN (dist/lib/config.js: getToken). RAPIDS_API_TOKEN
    # was the placeholder's invented name, which the CLI never reads, so a step
    # passing only that authenticates as nobody.
    for step in deploy_steps:
        run = step.get("run", "") or ""
        if "danube " in run:
            label = step.get("name")
            env = step.get("env", {}) or {}
            check("DANUBE_TOKEN" in env, f"'{label}' passes DANUBE_TOKEN to the CLI")
            check("RAPIDS_API_TOKEN" not in env,
                  f"'{label}' does not pass RAPIDS_API_TOKEN, which the CLI never reads")

    # The same discipline the migrate job already follows: pin the CLI, and prove
    # authentication works before mutating anything.
    joined = "\n".join((s.get("run", "") or "") for s in deploy_steps)
    check("DANUBE_CLI_VERSION" in yaml.safe_dump(jobs["deploy"]),
          "the deploy job pins the CLI version rather than floating")
    check("danube whoami" in joined, "the deploy job proves authentication before rolling out")
    check("danube rapids preflight" in joined,
          "the image is preflighted before the rollout is attempted")

    # The manifest is documentation rather than this CLI's deploy input, but a
    # leftover placeholder would still be copied into a console by hand.
    manifest_text = read("apps/web/rapids-service.yaml")
    check("REPLACE_WITH_DANUBEDATA_REGISTRY" not in manifest_text,
          "rapids-service.yaml carries no unresolved registry placeholder")

    # Asserted against the PARSED annotations rather than the file text: the file
    # explains in prose why the old `danubedata.com/region` key was removed, and
    # a raw substring check cannot tell an explanation from a live setting. The
    # thing that must not exist is a KEY on the wrong vendor domain.
    manifest = yaml.safe_load(manifest_text)
    annotation_keys = []
    for holder in (manifest.get("metadata", {}),
                   manifest.get("spec", {}).get("template", {}).get("metadata", {})):
        annotation_keys.extend((holder or {}).get("annotations", {}) or {})
    check(not [k for k in annotation_keys if "danubedata.com" in k],
          "rapids-service.yaml pins no annotation key on the wrong vendor domain")

    print("\n== configuration is readable from where the workflow reads it ==")
    # GitHub resolves environment-scoped secrets/variables ONLY for jobs that
    # declare `environment:`, and a job-level `if:` is evaluated BEFORE the
    # environment is attached at all. So an environment-scoped value read from
    # the wrong place does not error — it resolves to an EMPTY STRING.
    #
    # Found live on 2026-09-08: DEPLOY_ENABLED had been created as an
    # environment variable. Every deploy job silently skipped and the run went
    # GREEN, which is precisely the "success that deployed nothing" the summary
    # job exists to prevent. The summary caught it; nothing else would have.
    #
    # Names that MUST live at repository scope, with the reason each one cannot
    # be environment-scoped. Neither is sensitive: one is the word "true", the
    # other a public URL. Nothing secret is pushed out of the environment.
    REPOSITORY_SCOPED = {
        "DEPLOY_ENABLED": "read in job-level if:, which cannot see environment scope",
        "SITE_URL": "read by `smoke`, which declares no environment",
    }

    for name, job in jobs.items():
        if "uses" in job:  # reusable-workflow call; it has no env of its own
            continue
        has_env = job.get("environment") is not None
        blob = yaml.safe_dump(job)
        job_if = str(job.get("if", ""))

        # 1. A job-level `if:` can never see environment scope, environment
        #    declared or not.
        for var in sorted(set(re.findall(r"vars\.([A-Z_]+)", job_if))):
            check(var in REPOSITORY_SCOPED,
                  f"{name}: vars.{var} in a job-level if: is repository-scoped")

        if has_env:
            continue

        # 2. A job with no environment can only read repository scope.
        for var in sorted(set(re.findall(r"vars\.([A-Z_]+)", blob))):
            check(var in REPOSITORY_SCOPED,
                  f"{name} (no environment): vars.{var} is repository-scoped")

        # 3. A job with no environment must not read secrets at all. Rather than
        #    move a secret to repository scope to make it reachable, give the job
        #    an `environment:` — the protection is the point.
        leaked = sorted(set(re.findall(r"secrets\.([A-Z_]+)", blob)))
        check(not leaked,
              f"{name} (no environment) reads no secrets"
              + (f" — found {', '.join(leaked)}" if leaked else ""))

    # 4. The runbook must not tell an operator to create these anywhere else.
    runbook = read(".github/DEPLOY_RUNBOOK.md")
    for var in REPOSITORY_SCOPED:
        check(f"`{var}`" in runbook, f"DEPLOY_RUNBOOK documents {var}")
    check("Repository variables (not secret, repository scope" in runbook,
          "DEPLOY_RUNBOOK states the repository-vs-environment distinction")

    print(f"\n{checked - len(failures)}/{checked} invariants hold.")
    if failures:
        print("\nVIOLATIONS:")
        for item in failures:
            print(f"  - {item}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
