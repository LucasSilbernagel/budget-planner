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
ENV_CHECK_HELPER = ".github/scripts/rapids_env_check.py"

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
    check("pull_request" in triggers(ci), "the PR trigger (what branch protection evaluates) is intact")
    # Removed 2026-09-15: deploy.yml already runs these gates on every push to
    # main, so a standalone push run only duplicated ~8 minutes of runner time.
    check("push" not in triggers(ci), "no push trigger duplicating the deploy-nested gates")
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
    check("migrate" in needs_of(jobs, "deploy"), "deploy needs migrate (schema precedes code)")
    check("push-image" in needs_of(jobs, "deploy"), "deploy needs the image push directly")
    check("migration-check" in needs_of(jobs, "deploy"), "deploy needs the migration check directly")
    check(needs_of(jobs, "smoke") == ["deploy"], "smoke needs deploy")

    print("\n== the image builds in parallel, but only a gated build is pushed ==")
    # build-image dropped its `needs:` on 2026-09-15 so it runs alongside the
    # gates. That is only safe while it cannot publish anything.
    check(not needs_of(jobs, "build-image"), "build-image runs in parallel with the gates")
    check("secrets." not in yaml.safe_dump(jobs["build-image"]), "build-image reads no secrets")
    check("docker push" not in yaml.safe_dump(jobs["build-image"]), "build-image never pushes")
    push_needs = set(needs_of(jobs, "push-image"))
    check({"quality-gates", "type-check", "build-image"} <= push_needs,
          "push-image needs every gate and the verified build")

    print("\n== migrate may be skipped only when positively proven unnecessary ==")
    migrate_if = str(jobs["migrate"].get("if"))
    check("needs.migration-check.outputs.migrate == 'true'" in migrate_if,
          "migrate runs when the check reports pending migrations")
    deploy_if = " ".join(str(jobs["deploy"].get("if")).split())
    check("always()" not in deploy_if, "deploy never uses always()")
    check("!cancelled()" in deploy_if, "deploy does not run on a cancelled workflow")
    check("needs.push-image.result == 'success'" in deploy_if, "deploy requires a pushed image")
    check("needs.migrate.result == 'success'" in deploy_if, "deploy proceeds after a successful migrate")
    check("needs.migration-check.result == 'success'" in deploy_if
          and "needs.migration-check.outputs.migrate == 'false'" in deploy_if,
          "a skipped migrate is accepted only on an explicit 'false' from a successful check")
    smoke_if = str(jobs["smoke"].get("if"))
    check("needs.deploy.result == 'success'" in smoke_if, "smoke checks deploy's result explicitly")
    detect = "\n".join((st.get("run", "") or "") for st in jobs["migration-check"]["steps"])
    detect_env = yaml.safe_dump(jobs["migration-check"])
    check("decide true" in detect and detect.count("decide false") == 1,
          "the check has exactly one path to migrate=false; every other path migrates")
    check("manual dispatch always migrates" in detect, "a manual dispatch always migrates")
    check("packages/db/migrations" in detect_env, "the check diffs the migrations folder")
    check(jobs["deploy"].get("name") in detect_env,
          "the check looks up the deploy job by its real name")
    checkout = jobs["migration-check"]["steps"][0]
    check(checkout.get("with", {}).get("fetch-depth") == 0, "the check has full history to diff against")

    print("\n== the type-check gate uses live scripts, not the dead tsc:* ones ==")
    runs = [step.get("run", "") for step in jobs["type-check"]["steps"]]
    check(sum("type-check" in run for run in runs) == 4, "four per-package type-check steps")
    check(not any("tsc:" in run for run in runs), "never invokes the dead tsc:* scripts")

    print("\n== migration is ordered, abortive, and gated ==")
    steps = jobs["migrate"]["steps"]
    check(not any(s.get("continue-on-error") for s in steps), "no continue-on-error in migrate")
    check(jobs["migrate"].get("environment") == "production", "migrate sits in the production environment")

    # Story 5.18. The preflight -> drizzle-kit ordering moved INSIDE the image
    # (apps/web/migrate-entry.mjs, pinned by its own unit tests), so it is no
    # longer expressible as two workflow steps. What this file can still pin is
    # that the pipeline runs the migration in-cluster and reads a real verdict.
    print("\n== the ADR-001 public-DNS window is retired and cannot come back ==")
    migrate_block = yaml.safe_dump(jobs["migrate"])
    # Asserted over the executable surface — every step's `run:` script and its
    # `env:` block — NOT the raw file, so the comments that explain why the window
    # was retired do not read as the window still being there.
    # Every place a value can actually reach a runner: step `run:` bodies, step
    # `env:`, step `with:`, job-level `env:`, and the WORKFLOW-level `env:`.
    # The last two mattered: `DB_INSTANCE` — the variable whose only purpose was
    # naming the instance to the DNS-window commands — lived at workflow level,
    # so a check that skipped it would have called the window retired while the
    # variable that drove it sat there (code review 2026-09-15).
    executable = "\n".join(
        (step.get("run", "") or "")
        + "\n"
        + yaml.safe_dump(step.get("env", {}) or {})
        + yaml.safe_dump(step.get("with", {}) or {})
        for job in jobs.values()
        for step in (job.get("steps", []) or [])
    )
    executable += "\n" + yaml.safe_dump({name: job.get("env", {}) or {} for name, job in jobs.items()})
    executable += "\n" + yaml.safe_dump(deploy.get("env", {}) or {})
    check("db dns" not in executable, "no step opens or closes a public database endpoint")
    check("DATABASE_PUBLIC_HOST" not in executable, "the public-endpoint variable is gone")
    check("danubedata.ro:54" not in executable, "no public database endpoint is referenced")
    check("DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH" not in executable,
          "the verify-ca hostname waiver is gone (migrations run at verify-full)")
    check("svc.cluster.local" in migrate_block, "the migration targets the in-cluster writer")

    print("\n== the migrate container is started, read, and always left safe ==")
    ensure_i = next(i for i, s in enumerate(steps) if "rapids apply" in s.get("run", ""))
    update_i = next(i for i, s in enumerate(steps) if "--min-scale 1" in s.get("run", ""))
    verdict_i = next(i for i, s in enumerate(steps) if "migrate-status" in s.get("run", ""))
    teardown_i = len(steps) - 1
    teardown_run = steps[teardown_i].get("run", "")

    check(ensure_i < update_i, "the container is ensured before credentials are injected")
    check("--min-scale 0" in steps[ensure_i]["run"], "it is created idle at min-scale 0")
    check(update_i < verdict_i, "the verdict is read after the migration is started")
    check("--json" not in steps[update_i]["run"],
          "the credential-injecting step never uses --json (it would print DATABASE_URL)")
    check("APP_ENTRYPOINT=migrate" in steps[update_i]["run"], "the container runs in migrate mode")
    check("MIGRATE_RUN_ID=" in steps[update_i]["run"],
          "the container is bound to this run, so a stale verdict cannot be accepted")

    # ⚠️ The container must NEVER be deleted. Deleting a Rapids container leaves
    # its config orphaned in DanubeData's GitOps repo, and the next create of that
    # name fails to provision — it cost two live runs (2026-09-16). The safety
    # property deletion provided is now "credentials stripped", verified below.
    print("\n== the migrate container is never deleted, only emptied ==")
    all_migrate_runs = "\n".join((st.get("run", "") or "") for st in steps)
    check("rapids rm" not in all_migrate_runs,
          "no step deletes the container (deletion orphans its GitOps config)")
    check(str(steps[teardown_i].get("if")) == "${{ always() }}",
          "the container is emptied even on failure or cancellation")
    check("--rm-env" in teardown_run, "teardown strips the credentials")
    check("--min-scale 0" in teardown_run, "teardown scales it back to idle")
    for key in ("DATABASE_URL", "DATABASE_CA_CERT", "MIGRATE_STATUS_TOKEN"):
        check(key in teardown_run, f"teardown strips {key}")
    check("exit 1" in teardown_run, "a strip that cannot be verified fails the job")

    print("\n== non-zero exit codes that carry MEANING are captured, not fatal ==")
    for name, job in jobs.items():
        for step in job.get("steps", []) or []:
            run = step.get("run", "") or ""
            if not run:
                continue
            where = f"{name}/{step.get('name')}"
            # `case $?` reads the status of whatever ran immediately before, which
            # under -e has already killed the shell if it was non-zero.
            check("case $?" not in run,
                  f"{where} does not branch on a bare `case $?` (use `|| status=$?`)")
            # Join `\` continuations first: the guard is often on the NEXT physical
            # line, and a line-by-line check would flag correct code (it flagged
            # `smoke`'s grep, whose `|| { … exit 1; }` sits on the following line).
            logical = re.sub(r"\\\n\s*", " ", run)
            for line in logical.split("\n"):
                stripped = line.strip()
                if stripped.startswith("git diff --quiet") or stripped.startswith("grep -q"):
                    check("||" in stripped,
                          f"{where}: `{stripped[:48]}…` captures its status rather than tripping -e")

    # Both of these are regressions that ALREADY HAPPENED on a live run
    # (35042874267-1, 2026-09-16) and cost a stalled release each. Pinned so they
    # cannot come back quietly.
    print("\n== the verdict poll survives the platform's redirect ==")
    verdict_run_early = steps[verdict_i]["run"]
    check("curl -fsSL" in verdict_run_early,
          "the poll follows redirects (`rapids ls` reports http://, the edge 301s to https)")
    check('[ -n "${body}" ]' in verdict_run_early,
          "an empty 200 is not treated as a verdict")

    print("\n== migrations are serialised across pods ==")
    # Knative started TWO revisions of the migrate container and both ran
    # `drizzle-kit migrate` against production. `--min-scale 0` does not prevent
    # it, so the exclusion must live in the database.
    try:
        with open("packages/db/src/migrate-lock.ts", encoding="utf-8") as fh:
            lock_src = fh.read()
    except OSError:
        lock_src = ""
    check(bool(lock_src), "the migration advisory lock module exists")
    if lock_src:
        # Strip comments and block comments first. This module DISCUSSES
        # `pg_try_advisory_lock` at length to explain why it is the wrong
        # primitive here, and a check that read the prose would fail on the
        # explanation rather than on the code — the third time this exact trap
        # has appeared in this story's guards.
        lock_code = re.sub(r"/\*[\s\S]*?\*/", "", lock_src)
        lock_code = "\n".join(
            line for line in lock_code.split("\n") if not line.strip().startswith("//")
        )
        check("pg_advisory_lock" in lock_code, "it takes a PostgreSQL advisory lock")
        check("pg_try_advisory_lock" not in lock_code,
              "it BLOCKS rather than skipping (a skipping pod cannot report honestly)")
        check("lock_timeout" in lock_code, "the wait is bounded")
    try:
        with open("apps/web/src/server/migrate-runner.mjs", encoding="utf-8") as fh:
            runner_src = fh.read()
    except OSError:
        runner_src = ""
    check("migrate-lock-cli" in runner_src,
          "the container runs migrations through the lock CLI")
    check("'drizzle-kit'" not in runner_src,
          "the container never spawns drizzle-kit outside the lock")

    print("\n== the verdict and the teardown both fail CLOSED ==")
    verdict_run = steps[verdict_i]["run"]
    check(re.search(r'if\s+\[\s*"\$\{state\}"\s*=\s*"succeeded"\s*\]', verdict_run) is not None,
          "success is an explicit equality test on the parsed state, not a substring")
    check(re.search(r'exit 1\s*$', verdict_run.strip()) is not None,
          "the verdict step's last act on a non-success path is to exit non-zero")
    check('"${reported_run}" != "${RUN_ID}"' in verdict_run,
          "a verdict from a container this run did not start is rejected")
    # The HIGH this file failed to catch the first time: the teardown's answer must
    # be a WORD, because an exit code cannot distinguish "it is safe" from "we could
    # not tell". That lesson survived the move from delete-the-container to
    # strip-its-credentials; only the question changed.
    check("rapids_env_check.py" in teardown_run,
          "the credential check uses the three-state helper, not an ambiguous exit code")
    check('"${verdict}" = "clean"' in teardown_run,
          "teardown succeeds ONLY on an explicit clean")
    check('"${verdict}" = "error"' in teardown_run,
          "an unreadable listing is reported and fails the job rather than reading as clean")
    try:
        with open(ENV_CHECK_HELPER, encoding="utf-8") as fh:
            helper_src = fh.read()
    except OSError:
        helper_src = ""
    check(bool(helper_src), "the credential-check helper exists")
    if helper_src:
        # Strip the module docstring before asserting: it discusses the shapes it
        # rejects, and a check that matched the prose would fail on documentation
        # rather than on code.
        body = helper_src.split('"""')[-1] if helper_src.count('"""') >= 2 else helper_src
        check("sys.exit(0 if" not in body, "the helper never encodes its answer in an exit code")
        check("sys.exit(main())" in body, "the helper's only exit is main()'s return")
        for word in ("clean", "dirty", "error"):
            check(f'"{word}' in body, f"the helper can report {word}")
        # It reads rows that contain secret VALUES; it must emit names at most.
        check("environment_variables" in body, "the helper inspects the env map")
        check(".values()" not in body and "json.dumps" not in body,
              "the helper never emits an env VALUE")

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
        if re.search(r"secrets\.DANUBEDATA_REGISTRY|secrets\.DATABASE_MIGRATOR_PASSWORD|secrets\.DANUBE_TOKEN", block):
            check(job.get("environment") is not None,
                  f"{name} declares an environment for its scoped secrets")

    print("\n== least privilege, timeouts, and branch confinement ==")
    check(deploy["permissions"] == {"contents": "read"}, "workflow-level permissions are read-only")
    check(not any("permissions" in job for name, job in jobs.items() if name != "migration-check"),
          "no job widens permissions (except migration-check, pinned below)")
    check(jobs["migration-check"].get("permissions") == {"contents": "read", "actions": "read"},
          "migration-check adds only actions: read, to list previous runs")
    check(jobs["migration-check"].get("environment") is None, "migration-check holds no environment")
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
    deploy_step = next(
        (s for s in deploy_steps if s.get("name") == "Deploy revision to Rapids"), None
    )
    check(deploy_step is not None, "the deploy job has a 'Deploy revision to Rapids' step")
    if deploy_step is None:
        # Nothing below can run without the step; skip its invariants rather than
        # crash the whole validator on a rename.
        deploy_step = {"run": "", "env": {}}
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

    # Creating a container REQUIRES a resource profile; without it the API
    # returns 422 and the rollout dies after the migration has already run.
    check("--profile" in rollout, "the rollout names a resource profile")
    profile_env = str(deploy_step.get("env", {}).get("RESOURCE_PROFILE", ""))
    check("free" not in profile_env,
          "the profile is not the free tier, whose 128MB and max-scale-3 the rollout would exceed")

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

    print("\n== registry retention cannot eat its own rollback targets ==")
    # A 500 MB registry filled after six SHA-tagged pushes and the seventh died
    # with `denied: Storage quota exceeded` (run 34497637074, 2026-09-10).
    # Pruning fixes that, but two safety properties must hold:
    #   1. The prune runs BEFORE the push. A prune after a failed push never
    #      runs, so a registry already at quota stays wedged forever — which is
    #      exactly what happened. Pruning first lets it self-heal.
    #   2. Rollback (DEPLOY_RUNBOOK §6) redeploys an EARLIER tag, so an over-eager
    #      prune deletes the thing you would roll back to.
    # These pin both.
    build_steps = jobs["push-image"]["steps"]
    names = [str(step.get("name", "")) for step in build_steps]
    check("Prune old image tags" in names, "push-image has a 'Prune old image tags' step")
    check(
        "Push image to the DanubeData registry" in names,
        "push-image has a 'Push image to the DanubeData registry' step",
    )
    # A rename fails the two checks above with a clean report; the position and
    # body invariants below simply can't run, so guard rather than IndexError.
    if "Prune old image tags" in names and "Push image to the DanubeData registry" in names:
        push_at = names.index("Push image to the DanubeData registry")
        prune_at = names.index("Prune old image tags")
        prune = build_steps[prune_at]["run"]

        check(prune_at < push_at, "tags are pruned BEFORE the push, so a full registry self-heals")
        check("GITHUB_SHA" in prune, "the prune refuses to delete this run's own tag")
        check("--force" in prune,
              "rm-tag is forced (an interactive prompt would hang the runner)")
        check(build_steps[prune_at].get("continue-on-error") is True,
              "a prune failure warns rather than failing an otherwise-valid deploy")
        check("KEEP_TAGS" in prune and ":-2}" in prune,
              "retention is configurable and defaults to 2 rollback targets "
              "(was 5 until fat images blew the 500 MB plan, run 34528527480)")
        # A non-numeric or too-low REGISTRY_KEEP_TAGS must not silently wipe
        # every rollback target (KEEP=0 → delete all) or fail-open under
        # continue-on-error. The prune script clamps to >=1 and rejects
        # non-integers loudly. (Review 2026-09-10.)
        check("[!0-9]" in prune or "isdigit" in prune or "ValueError" in prune,
              "the prune rejects a non-numeric REGISTRY_KEEP_TAGS instead of no-op'ing")
        check("-lt 1" in prune or "max(1," in prune,
              "the prune clamps retention to at least one rollback target")
        check("<<<" in prune or "/dev/null" in prune,
              "the rm-tag loop is not fed by a bare pipe (a CLI stdin read would drain it)")
        # Deleting is the irreversible half; it must never run while deploys are off.
        check("DEPLOY_ENABLED" in str(build_steps[prune_at].get("if", "")),
              "the prune is gated on DEPLOY_ENABLED like every other mutating step")

    print("\n== every job brings its own toolchain ==")
    # Each job gets a fresh runner. A job that invokes a tool must set that tool
    # up itself; nothing carries over from a job that ran earlier.
    #
    # Found live on 2026-09-08: the `deploy` job ran `pnpm add -g` with no pnpm
    # setup and failed with `pnpm: command not found` — AFTER the migration had
    # already been applied to production, which is the expensive half of the run
    # to have to repeat.
    for name, job in jobs.items():
        if "uses" in job:
            continue
        steps = job.get("steps", []) or []
        runs = "\n".join((step.get("run", "") or "") for step in steps)
        actions = [str(step.get("uses", "")) for step in steps]
        if re.search(r"(^|[\s|&;(])pnpm\s", runs):
            check(any(a.startswith("pnpm/action-setup") for a in actions),
                  f"{name} runs pnpm and sets pnpm up")
            check(any(a.startswith("actions/setup-node") for a in actions),
                  f"{name} runs pnpm and sets Node up")

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
