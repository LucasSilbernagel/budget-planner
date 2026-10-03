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

import glob
import json
import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    print("SKIP: PyYAML not installed (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

# Overridable so story 85.1's broken-ci.yml fixtures can prove each check RED.
# Not `CI`: GitHub Actions sets CI=true on every runner.
CI = os.environ.get("VALIDATE_CI_PATH") or ".github/workflows/ci.yml"
DEPLOY = ".github/workflows/deploy.yml"
ENV_CHECK_HELPER = ".github/scripts/rapids_env_check.py"
DEPLOYED_TAGS_HELPER = ".github/scripts/rapids_deployed_tags.py"
VERDICT_HELPER = ".github/scripts/rapids_verdict.py"
# Story ops-1: the image size guard, the two-mode image check and the registry
# report, shared by deploy.yml and the PR-only container-image.yml.
IMAGE_WORKFLOW = ".github/workflows/container-image.yml"
IMAGE_SIZE_HELPER = ".github/scripts/image_size.py"
VERIFY_IMAGE_HELPER = ".github/scripts/verify-image.sh"
REGISTRY_REPORT_HELPER = ".github/scripts/registry-report.sh"
WEB_PACKAGE = "apps/web/package.json"
# App (strict, excludes tests), unit tests + test helpers, Playwright specs.
WEB_TYPECHECK_CONFIGS = ("tsconfig.app.json", "tsconfig.vitest.json", "tsconfig.e2e.json")
# Story 78.4: the build config (strict, excludes tests) and the no-emit test
# config (tests + root-level TS files, relaxed index-access flags).
PACKAGE_TYPECHECK_CONFIGS = ("tsconfig.json", "tsconfig.test.json")
# package -> (package.json, the deploy step's exact `run`, configs its script must name)
TYPECHECK_SCRIPTS = {
    "web": (WEB_PACKAGE, "pnpm --filter web type-check", WEB_TYPECHECK_CONFIGS),
    "core": (
        "packages/core/package.json",
        "pnpm --filter @budget-planner/core type-check",
        PACKAGE_TYPECHECK_CONFIGS,
    ),
    "db": (
        "packages/db/package.json",
        "pnpm --filter @budget-planner/db type-check",
        PACKAGE_TYPECHECK_CONFIGS,
    ),
}
# Story 78.4 review: the package test configs themselves, so a config that still
# exists but checks nothing (a narrowed `include`, a test-excluding `exclude`)
# cannot pass on its name alone.
PACKAGE_TEST_CONFIGS = ("packages/core/tsconfig.test.json", "packages/db/tsconfig.test.json")

failures: list[str] = []
checked = 0


def check(condition: object, label: str) -> None:
    global checked
    checked += 1
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


def code_only(script: str) -> str:
    """A shell script with its comment lines removed.

    ⚠️ Use this for every ABSENCE assertion. Four separate checks in this file
    have failed on their own documentation: a step comment saying "never add
    `--json` here", a Dockerfile note discussing `pnpm deploy --prod`, a module
    docstring quoting the `sys.exit(0 if …)` shape it replaced, and another
    explaining why `pg_try_advisory_lock` is wrong. Each time the guard was right
    and the prose tripped it. Absence of a STRING is not absence of a BEHAVIOUR —
    check what runs, not what is written about it.
    """
    return "\n".join(
        line for line in script.split("\n") if not line.strip().startswith("#")
    )


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


SHARD_RESULT_ENV = "${{ needs.unit-shards.result }}"
SHARD_RESULT_TEST = 'test "${SHARDS_RESULT}" = "success"'
AGGREGATOR_RUN = ['echo "unit-shards result: ${SHARDS_RESULT}"', SHARD_RESULT_TEST]
# The sharded package and the command CI runs for it. CI calls the binary
# directly (so --shard reaches Vitest), so the package's own script must be
# exactly what CI runs minus the flag, or CI and `pnpm test:unit` drift apart.
SHARDED_PACKAGE = "apps/web"
SHARDED_SCRIPT = "vitest run --config vitest.config.ts"
SHARD_ONE_IF = "${{ !cancelled() && matrix.shard == 1 }}"
SETUP_ACTIONS = ("actions/checkout@", "pnpm/action-setup@", "actions/setup-node@")
INSTALL_RUN = "pnpm install --frozen-lockfile"


def _dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list:
    return value if isinstance(value, list) else []


def _str(value: object) -> str:
    return value if isinstance(value, str) else ""


def workspace_test_packages() -> dict[str, str]:
    """{directory: package name} for every pnpm workspace package with a
    `test:unit` script, from the globs in pnpm-workspace.yaml (85.1 review P5).
    A malformed file or package.json yields fewer packages, which the caller's
    floor check reports, never a traceback (P6)."""
    try:
        globs = _list(_dict(yaml.safe_load(read("pnpm-workspace.yaml"))).get("packages"))
    except (OSError, yaml.YAMLError):
        globs = []
    packages: dict[str, str] = {}
    for pattern in globs:
        for path in sorted(glob.glob(f"{_str(pattern)}/package.json")):
            try:
                package = json.loads(read(path))
            except (OSError, json.JSONDecodeError):
                continue
            scripts = _dict(_dict(package).get("scripts"))
            if "test:unit" in scripts:
                packages[os.path.dirname(path)] = _str(_dict(package).get("name"))
    return packages


def check_unit_shards(ci_jobs: dict) -> None:
    """Story 85.1: the web Vitest run is split across a matrix job, and the
    required check `Unit tests (Vitest)` survives as an aggregator over it.

    ⚠️ Branch protection on `main` requires the context `Unit tests (Vitest)`,
    and GitHub treats a SKIPPED required check as passing. So the aggregator
    must run `if: always()` and must pass ONLY on an explicit 'success' from the
    shards: `!= 'failure'` would pass a cancelled or skipped shard run.

    Both jobs are pinned by EXACT shape, not by substrings (85.1 review): a
    step `if: false`, an earlier `exit`, a `|| true`, a path filter, an extra
    `pnpm test:unit` step or a matrix `exclude` each passed the first version.
    Every malformed shape is a FAIL line, never a traceback.
    """
    print("\n== the unit tests are sharded, and the required check aggregates them (85.1) ==")
    shards = _dict(ci_jobs.get("unit-shards"))
    agg = _dict(ci_jobs.get("unit-tests"))

    # --- the aggregator: the required check -----------------------------------
    check(agg.get("name") == "Unit tests (Vitest)",
          "the aggregator keeps the required check name `Unit tests (Vitest)`")
    agg_needs = agg.get("needs", [])
    check((agg_needs if isinstance(agg_needs, list) else [agg_needs]) == ["unit-shards"],
          "the aggregator needs exactly unit-shards")
    check(re.fullmatch(r"\$\{\{\s*always\(\)\s*\}\}|always\(\)", str(agg.get("if", "")).strip()) is not None,
          "the aggregator runs `if: always()` (a skipped required check counts as passing)")
    check("timeout-minutes" in agg and "timeout-minutes" in shards,
          "the aggregator and the shards both have a timeout")
    # Job-level keys that can change what its one step does or whether it counts.
    check(not {"defaults", "env", "strategy", "container", "services", "continue-on-error"} & set(agg),
          "the aggregator job has no defaults, env, strategy, container or continue-on-error")
    agg_steps = _list(agg.get("steps"))
    agg_step = _dict(agg_steps[0]) if len(agg_steps) == 1 else {}
    # No `if:` (a skipped step leaves the job green), no `shell:`, no `uses:`.
    check(len(agg_steps) == 1 and isinstance(agg_steps[0], dict)
          and set(agg_step) <= {"name", "env", "run"},
          "the aggregator is ONE run step with no if, shell, uses or continue-on-error")
    check(_dict(agg_step.get("env")) == {"SHARDS_RESULT": SHARD_RESULT_ENV},
          "the aggregator's only input is needs.unit-shards.result")
    agg_code = [line.strip() for line in code_only(_str(agg_step.get("run"))).split("\n") if line.strip()]
    # EXACT script: nothing before the test can exit or rebind, and only the
    # literal word success passes (cancelled, skipped and failure all fail).
    check(agg_code == AGGREGATOR_RUN,
          "the aggregator's script is exactly: echo the result, then `test … = \"success\"`")

    # --- the matrix ------------------------------------------------------------
    strategy = _dict(shards.get("strategy"))
    matrix = _dict(strategy.get("matrix"))
    shard_list = _list(matrix.get("shard"))
    count = len(shard_list)
    check(strategy.get("fail-fast") is False, "one failing shard does not cancel the other")
    # include/exclude can add or DROP shards while `shard:` still reads [1, 2].
    check(set(matrix) == {"shard"}, "the matrix has only the shard axis (no include, exclude or expression)")
    check(count >= 2 and shard_list == list(range(1, count + 1)),
          "the matrix lists shards 1..N with N >= 2")
    check(shards.get("name") == f"Unit tests (Vitest) shard ${{{{ matrix.shard }}}}/{count}",
          "the shard job's name carries the same N as the matrix")
    check(not {"if", "defaults", "continue-on-error"} & set(shards),
          "the shard job has no if, defaults or continue-on-error")

    # --- the steps: exactly the expected set, each in its exact form ----------
    packages = workspace_test_packages()
    check(all(packages.values()),
          "every workspace package with test:unit has a name (a nameless one could not be --filter'ed)")
    check(len(packages) >= 3 and SHARDED_PACKAGE in packages,
          f"the workspace scan found the test packages ({', '.join(packages) or 'none'})")
    try:
        root_script = _dict(_dict(json.loads(read("package.json"))).get("scripts")).get("test:unit")
    except (OSError, json.JSONDecodeError):
        root_script = None
    check(root_script == "pnpm -r run test:unit",
          "root test:unit is `pnpm -r run test:unit` (the workspace set the scan mirrors)")
    try:
        sharded_script = _dict(_dict(json.loads(read(f"{SHARDED_PACKAGE}/package.json"))).get("scripts")).get("test:unit")
    except (OSError, json.JSONDecodeError):
        sharded_script = None
    check(sharded_script == SHARDED_SCRIPT,
          f"{SHARDED_PACKAGE}'s test:unit is `{SHARDED_SCRIPT}`, which CI runs plus --shard")

    sharded_run = (f"cd {SHARDED_PACKAGE} && ./node_modules/.bin/{SHARDED_SCRIPT} "
                   f"--shard=${{{{ matrix.shard }}}}/{count}")
    expected = {sharded_run: None, INSTALL_RUN: None}
    expected.update({f"pnpm --filter {name} test:unit": SHARD_ONE_IF
                     for directory, name in packages.items() if directory != SHARDED_PACKAGE and name})
    seen: dict[str, int] = {}
    unexpected: list[str] = []
    actions: list[str] = []
    for step in _list(shards.get("steps")):
        step = _dict(step)
        label = _str(step.get("name")) or "?"
        if not set(step) <= {"name", "uses", "with", "run", "if"}:
            unexpected.append(f"{label}: {sorted(set(step) - {'name', 'uses', 'with', 'run', 'if'})}")
        if "uses" in step:
            actions.append(_str(step.get("uses")))
            if "if" in step or "run" in step:
                unexpected.append(f"{label}: a setup action with if/run")
            continue
        run = " ".join(code_only(_str(step.get("run"))).split())
        step_if = " ".join(str(step["if"]).split()) if "if" in step else None
        if run in expected and expected[run] == step_if:
            seen[run] = seen.get(run, 0) + 1
        else:
            unexpected.append(f"{label}: `{run}` if={step_if}")
    check(sorted(a.split("@")[0] + "@" for a in actions) == sorted(SETUP_ACTIONS),
          "each shard checks out and sets up pnpm + Node, once each")
    check(not unexpected,
          "every shard step is setup, install, the sharded run or a shard-1 package run, in its exact form"
          + (f" (unexpected: {'; '.join(unexpected)})" if unexpected else ""))
    for run in expected:
        check(seen.get(run) == 1, f"the shard job runs `{run}` exactly once")
    web_step = next((_dict(s) for s in _list(shards.get("steps"))
                     if " ".join(code_only(_str(_dict(s).get("run"))).split()) == sharded_run), {})
    check(f"/{count})" in _str(web_step.get("name")), "the sharded step's name carries the same N as the matrix")


def main() -> int:
    ci, deploy = load(CI), load(DEPLOY)
    jobs = deploy["jobs"]
    raw = open(DEPLOY, encoding="utf-8").read()

    print("\n== ci.yml: story 4-15's contract is preserved ==")
    # 85.1 review P7: the fixture override must never be silent, or active in CI.
    if CI != ".github/workflows/ci.yml":
        print(f"  NOTE  validating ci.yml from the VALIDATE_CI_PATH override: {CI}")
    check(CI == ".github/workflows/ci.yml" or os.environ.get("GITHUB_ACTIONS") != "true",
          "the VALIDATE_CI_PATH fixture override is not active in CI")
    # Story 85.1: `unit-shards` is new; the three REQUIRED check names (lint,
    # unit-tests, e2e-tests job names) are unchanged.
    check(set(ci["jobs"]) == {"lint", "unit-shards", "unit-tests", "e2e-tests"},
          "the gate jobs are lint, unit-shards, unit-tests (aggregator) and e2e-tests")
    check("pull_request" in triggers(ci), "the PR trigger (what branch protection evaluates) is intact")
    # Removed 2026-09-15: deploy.yml already runs these gates on every push to
    # main, so a standalone push run only duplicated ~8 minutes of runner time.
    check("push" not in triggers(ci), "no push trigger duplicating the deploy-nested gates")
    check("workflow_call" in triggers(ci), "workflow_call exposed for the deploy gate")
    check_unit_shards(ci["jobs"])

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

    # Story 78.2. The step above runs `pnpm --filter web type-check`, so what it
    # actually checks lives in apps/web/package.json, not here. Before 78.2 that
    # script named only tsconfig.app.json, which EXCLUDES every test file, and
    # no gate type-checked a test or an e2e spec. Pin the script itself: each
    # config must be named, and the commands must be joined by `&&` so a failing
    # first `tsc` cannot be masked by a passing second one (`;` would do that).
    # Story 78.4 extends the same pin to core and db, whose test files were
    # excluded by their build tsconfig until then.
    check(not jobs["type-check"].get("continue-on-error")
          and not any(step.get("continue-on-error") for step in jobs["type-check"]["steps"]),
          "no continue-on-error anywhere in the type-check job")
    # `if: false` on a step (or the job) skips it and the job still succeeds, so
    # the exact `run` pin below would hold over a gate that never runs (78.4
    # review, measured). Nothing in this job is conditional today; keep it so.
    check("if" not in jobs["type-check"]
          and not any("if" in step for step in jobs["type-check"]["steps"]),
          "no `if:` on the type-check job or any of its steps")
    for name, (package_json, step_run, required_configs) in TYPECHECK_SCRIPTS.items():
        # Web keeps its pre-78.4 labels; the others name their package.
        scope = "" if name == "web" else f"{name} "
        if name == "web":
            print("\n== the web type-check covers the app, the unit tests and the e2e specs ==")
        else:
            print(f"\n== the {name} type-check covers the package and its test files ==")
        # EXACT, not a substring: `pnpm --filter web type-check || true` contains the
        # substring and would turn the gate into a no-op (78.2 review, measured).
        check(any(run.strip() == step_run for run in runs),
              f"the gate runs the {name} package's own type-check script, unmodified")
        # A malformed package.json must be a reported FAIL, not a traceback that
        # skips every later check.
        try:
            package = json.loads(read(package_json))
            scripts = package.get("scripts")
            package_name = package.get("name")
        except (OSError, json.JSONDecodeError, AttributeError):
            scripts = package_name = None
        check(isinstance(scripts, dict), f"{package_json} parses and has a scripts table")
        # A `--filter` that matches no project makes pnpm print "No projects
        # matched the filters" and exit 0: the step would check nothing (78.4
        # review, measured). pnpm also matches a scoped name by its bare part.
        step_filter = step_run.split()[2]
        check(isinstance(package_name, str)
              and (package_name == step_filter or package_name.endswith("/" + step_filter)),
              f"the {name} step's --filter {step_filter} matches {package_json}'s name")
        script = scripts.get("type-check", "") if isinstance(scripts, dict) else ""
        script = script if isinstance(script, str) else ""
        commands = [part.strip() for part in script.split("&&")]
        check(not re.search(r";|\|\|", script), f"the {scope}type-check commands are joined only by &&")
        configs = [
            match.group(1)
            for command in commands
            if (match := re.fullmatch(r"tsc --noEmit -p (\S+)", command))
        ]
        check(len(configs) == len(commands),
              f"every {scope}type-check command is a plain `tsc --noEmit -p <config>`")
        for config in required_configs:
            check(config in configs, f"the {name} type-check names {config}")
        # Order and exact membership: the STRICT program runs first, and no extra
        # or duplicated config rides along.
        check(configs == list(required_configs),
              f"the {name} type-check runs exactly {' then '.join(required_configs)}")

    print("\n== the core and db test configs check the whole package, and emit nothing ==")
    for path in PACKAGE_TEST_CONFIGS:
        try:
            test_config = json.loads(read(path))
        except (OSError, json.JSONDecodeError):
            test_config = None
        check(isinstance(test_config, dict), f"{path} parses")
        test_config = test_config if isinstance(test_config, dict) else {}
        options = test_config.get("compilerOptions") or {}
        include = test_config.get("include") or []
        exclude = test_config.get("exclude") or []
        check(test_config.get("extends") == "./tsconfig.json", f"{path} extends the package build config")
        check(options.get("noEmit") is True and options.get("composite") is False,
              f"{path} is noEmit and not composite")
        check("src/**/*" in include and "*.ts" in include,
              f"{path} includes all of src/ and every root-level .ts file")
        check(not any(re.search(r"test|spec", str(pattern)) for pattern in exclude),
              f"{path} excludes no test files")

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

    print("\n== the migration starts in ONE call, and the rollout is confirmed ==")
    start_i = next(i for i, s in enumerate(steps) if "rapids apply" in s.get("run", ""))
    verdict_i = next(i for i, s in enumerate(steps) if "migrate-status" in s.get("run", ""))
    teardown_i = len(steps) - 1
    teardown_run = steps[teardown_i].get("run", "")
    start_run = steps[start_i]["run"]

    # ⚠️ EXACTLY ONE mutating call may configure and start the container.
    # DanubeData confirmed (2026-09-16) that an update arriving while the previous
    # update to the same container was still rolling out was accepted, returned
    # success, and was never applied. The old design issued `apply` then `update`
    # seconds apart on every run — that collision, built in. Two live runs were
    # lost to it before the cause was known. CLI 1.3.0's `apply --env` makes one
    # call sufficient; keep it that way.
    env_setters = [i for i, s in enumerate(steps)
                   if "--env " in (s.get("run", "") or "") and "--rm-env" not in (s.get("run", "") or "")]
    check(env_setters == [start_i],
          "exactly one step sets the container's environment (no create+update pair)")
    check("APP_ENTRYPOINT=migrate" in start_run, "that call puts the container in migrate mode")
    check("MIGRATE_RUN_ID=" in start_run,
          "the container is bound to this run, so a stale verdict cannot be accepted")
    check("--min-scale 1" in start_run, "and starts it, rather than leaving it idle")
    # Generation-aware in 1.3.0: returns only once THIS call's spec_generation is
    # observed and the operation is terminal. A green step therefore means the
    # configuration is LIVE, not merely accepted — which is the distinction that
    # cost two runs.
    check("--wait" in start_run, "it waits for its own rollout to actually land")
    check("--json" not in code_only(start_run),
          "the credential-carrying step never uses --json (it would print DATABASE_URL)")
    check(start_i < verdict_i, "the verdict is read after the migration is started")

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

    # ⚠️ The HTTP endpoint is reached through the container's public URL, which
    # Knative routes to whatever revision is currently READY — not necessarily the
    # one that migrated. Run 35042874267-1 succeeded and then answered every poll
    # with 401 from a successor revision, so the job timed out on finished work.
    # Logs aggregate across revisions; the run id makes a line attributable.
    print("\n== the verdict has a second channel that survives revision churn ==")
    check("rapids_verdict.py" in verdict_run_early,
          "the poll also reads the verdict from the container logs")
    check('"${RUN_ID}"' in verdict_run_early,
          "the log verdict is matched against THIS run's id")
    try:
        with open(VERDICT_HELPER, encoding="utf-8") as fh:
            verdict_src = fh.read()
    except OSError:
        verdict_src = ""
    check(bool(verdict_src), "the verdict helper exists")
    if verdict_src:
        vbody = verdict_src.split('"""')[-1] if verdict_src.count('"""') >= 2 else verdict_src
        # "not finished yet" and "cannot tell" must stay different answers.
        check('"none"' in vbody and '"error"' in vbody,
              "it distinguishes 'no verdict yet' from 'logs unreadable'")
        check('available' in vbody,
              "an unavailable log backend reads as error, never as 'no verdict'")
        check("\\S+" not in vbody,
              "its field patterns are narrow (a greedy one read `succeeded\"}` as a failure)")
    # The container has to emit what the helper parses.
    try:
        with open("apps/web/migrate-entry.mjs", encoding="utf-8") as fh:
            entry_src = fh.read()
    except OSError:
        entry_src = ""
    # The sentinel is assembled, not a literal, so match its parts.
    check("VERDICT ${parts.join" in entry_src and "run=${runId}" in entry_src,
          "the container emits the verdict sentinel the helper parses")
    check("emitVerdict(result)" in entry_src and "emitVerdict({ state: 'failed'" in entry_src,
          "both the normal and the unexpected-failure paths emit it")

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
        # ⚠️ THE OUTAGE OF 2026-09-16. The prune deleted the tag `budget-planner-web`
        # was running; a deployed Knative revision is pinned to that exact image, so
        # the site died on its next cold start with `manifest unknown`. Sparing this
        # run's own SHA was never enough — what matters is what is RUNNING.
        check("rapids_deployed_tags.py" in prune,
              "the prune asks which tags are currently deployed")
        check("tag in deployed" in prune,
              "a tag a container is deployed from is never pruned, whatever its age")
        check("skipping the prune entirely" in prune,
              "if the deployed tags cannot be read, the prune does nothing (fails closed)")
        try:
            with open(DEPLOYED_TAGS_HELPER, encoding="utf-8") as fh:
                tags_src = fh.read()
        except OSError:
            tags_src = ""
        check(bool(tags_src), "the deployed-tags helper exists")
        if tags_src:
            tags_body = tags_src.split('"""')[-1] if tags_src.count('"""') >= 2 else tags_src
            # Unlike the other helpers, this one's exit status IS the signal:
            # "could not tell" must be distinguishable from "nothing is deployed".
            check("return None" in tags_body,
                  "an unreadable listing returns None rather than an empty list")
            check("return 1" in tags_body, "and exits non-zero so the caller skips pruning")
            check("environment_variables" not in tags_body,
                  "the helper never touches the env map it is reading past")
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

    print("\n== the image fits the registry, and is proven in both modes before a push (ops-1) ==")
    # 2026-10-02: a ~173 MB image, 2 rollback tags, the live tag and the
    # migrator's pinned tag did not fit the 500 MB plan, and the push died
    # AFTER every gate had run. The budget is now enforced at build time.
    push_if = " ".join(str(jobs["push-image"].get("if")).split())
    check("vars.DEPLOY_ENABLED == 'true'" in push_if and "github.ref == 'refs/heads/main'" in push_if,
          "push-image (prune + push) is confined to main, so a branch dispatch cannot spend quota")
    image_steps = jobs["build-image"]["steps"]
    image_names = [str(step.get("name", "")) for step in image_steps]
    for wanted in ("Check the image size budget", "Verify the image serves and migrates",
                   "Export the verified image"):
        check(wanted in image_names, f"build-image has a '{wanted}' step")
    if all(n in image_names for n in ("Check the image size budget",
                                      "Verify the image serves and migrates",
                                      "Export the verified image")):
        size_at = image_names.index("Check the image size budget")
        verify_at = image_names.index("Verify the image serves and migrates")
        export_at = image_names.index("Export the verified image")
        check(size_at < export_at and verify_at < export_at,
              "the size budget and both modes are checked before the image is handed to push-image")
        size_run = code_only(image_steps[size_at].get("run", "") or "")
        check("image_size.py" in size_run and "--report-only" not in size_run,
              "build-image FAILS over budget (no --report-only)")
        check(image_steps[size_at].get("continue-on-error") is not True,
              "the size budget step is not continue-on-error")
        check("verify-image.sh" in (image_steps[verify_at].get("run", "") or ""),
              "build-image runs the shared serve + migrate check")
    try:
        size_src = read(IMAGE_SIZE_HELPER)
    except OSError:
        size_src = ""
    check(bool(size_src), "the image size helper exists")
    if size_src:
        namespace: dict = {}
        exec(compile(size_src.split("\ndef ")[0], IMAGE_SIZE_HELPER, "exec"), namespace)
        check(namespace.get("BUDGET_BYTES") == 112_000_000,
              "the budget is (500 - 50) MB / (2 keep + 1 live + 1 migrator pin) = 112 MB")
        check(namespace.get("KEEP_TAGS") == 2, "the budget assumes REGISTRY_KEEP_TAGS = 2, the prune's default")
    try:
        verify_src = code_only(read(VERIFY_IMAGE_HELPER))
    except OSError:
        verify_src = ""
    check(bool(verify_src), "the serve + migrate image check exists")
    for needle, label in (
        ("/api/health", "serve: health"),
        ("Accept-Encoding: br", "serve: compression is requested"),
        ("*.js.br", "serve: a precompressed sibling must exist (positive control)"),
        ("id -un", "serve: runs as the unprivileged user"),
        ("APP_ENTRYPOINT=migrate", "migrate: the migrate mode is exercised"),
        ("[migrate-entry] IDLE", "migrate: the idle branch is checked"),
        ("VERDICT run=", "migrate: the verdict sentinel is read"),
        ("select count(*) from drizzle.__drizzle_migrations", "migrate: applied rows are counted against the journal"),
    ):
        check(needle in verify_src, f"verify-image.sh checks {label}")
    check("docker push" not in verify_src and "danube" not in verify_src,
          "verify-image.sh pushes nothing and calls no platform CLI")

    # AC-1: the registry numbers are printed every run, around the prune and push.
    push_names = [str(step.get("name", "")) for step in jobs["push-image"]["steps"]]
    order = ["Registry usage before prune", "Prune old image tags", "Registry usage after prune",
             "Push image to the DanubeData registry", "Registry usage after push"]
    check(all(n in push_names for n in order) and
          [push_names.index(n) for n in order] == sorted(push_names.index(n) for n in order),
          "registry usage is reported before the prune, after it, and after the push")
    for step in jobs["push-image"]["steps"]:
        if str(step.get("name", "")).startswith("Registry usage"):
            check(step.get("continue-on-error") is True,
                  f"'{step.get('name')}' is report-only (continue-on-error)")
    try:
        report_src = code_only(read(REGISTRY_REPORT_HELPER))
    except OSError:
        report_src = ""
    check(bool(report_src), "the registry report helper exists")
    check("rapids" not in report_src,
          "the registry report never reads rapids output (container env carries credentials)")

    # D5: the PR-time image check builds and verifies and can publish nothing.
    try:
        image_wf = load(IMAGE_WORKFLOW)
    except OSError:
        image_wf = {}
    check(bool(image_wf), "container-image.yml exists")
    if image_wf:
        check(set(triggers(image_wf)) == {"pull_request", "workflow_dispatch"},
              "container-image.yml runs on PRs (and by hand), never on push")
        image_blob = yaml.safe_dump(image_wf)
        check("secrets." not in image_blob, "container-image.yml reads no secrets")
        check("environment" not in image_wf.get("jobs", {}).get("container-image", {}),
              "container-image.yml holds no environment")
        check("docker push" not in image_blob and "danube" not in image_blob,
              "container-image.yml pushes nothing and calls no platform CLI")
        check(image_wf.get("permissions") == {"contents": "read"},
              "container-image.yml is read-only")
        check("image_size.py" in image_blob and "verify-image.sh" in image_blob,
              "container-image.yml runs the same size guard and image check as build-image")

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
