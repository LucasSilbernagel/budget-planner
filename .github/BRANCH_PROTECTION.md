# Branch Protection — required CI checks (Story 4-15, AC-2)

The CI workflow (`.github/workflows/ci.yml`) only *reports* pass/fail. Blocking
a failing PR from merging is enforced by a **branch protection rule** on `main`,
which lives in GitHub repository settings — it cannot be committed as code and
requires repository **admin** access to apply.

## Required status checks

Configure these three checks (the job `name:` values from `ci.yml`) as required:

- `Lint (Biome + tsconfig)`
- `Unit tests (Vitest)`
- `E2E tests (Playwright)`

## Apply via GitHub UI

Settings → Branches → Add branch ruleset (or "Add rule") for `main`:

1. **Require a pull request before merging.**
2. **Require status checks to pass before merging** → search for and select the
   three checks above. Also enable **Require branches to be up to date before
   merging**.
3. (Recommended) **Do not allow bypassing the above settings.**

> The three checks only appear in the search box after the workflow has run at
> least once (open a throwaway PR to populate them).

## Apply via `gh` CLI

```sh
# Note: -F sends typed JSON (booleans/integers/null); -f sends raw strings.
# `strict` (boolean) and `required_approving_review_count` (integer) MUST use -F,
# or the API rejects the string values with a 422.
gh api -X PUT repos/LucasSilbernagel/budget-planner/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[checks][][context]=Lint (Biome + tsconfig)' \
  -f 'required_status_checks[checks][][context]=Unit tests (Vitest)' \
  -f 'required_status_checks[checks][][context]=E2E tests (Playwright)' \
  -F 'enforce_admins=true' \
  -F 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'restrictions=null'
```

## Verify

```sh
gh api repos/LucasSilbernagel/budget-planner/branches/main/protection \
  --jq '.required_status_checks.checks[].context'
```

Then open a PR with a deliberately failing check (e.g. a Biome violation) and
confirm the **Merge** button is blocked until the check passes.

---

## ⚠️ These three job names are load-bearing (Story 5-4)

`ci.yml` is now also invoked as a **reusable workflow** by
[`deploy.yml`](workflows/deploy.yml), which gates the production deploy on it.
That change was additive — the `pull_request` / `push` triggers and the three
job `name:` values above are untouched, so the required checks configured here
still resolve.

Renaming any of those three jobs therefore breaks **two** things at once: the
required status checks listed above silently stop matching (a rule that requires
a check which no longer exists blocks merges), and the deploy gate's job graph
changes. If you rename one, update this file *and* re-select the check in the
branch protection rule.

Note that when `ci.yml` runs *inside* `deploy.yml` its checks report under a
different context string from the standalone run — GitHub prefixes a called
workflow's jobs with the **calling job's** name, so the nested contexts read as
`Quality gates / Lint (Biome + tsconfig)` rather than the bare
`Lint (Biome + tsconfig)` the rule below matches. **Confirm the exact strings
against a real run before relying on them** — the nesting format is easy to get
wrong by a level, and nothing in this repo can verify it offline.

Either way the instruction is the same: branch protection should keep using the
standalone `ci.yml` PR contexts listed above. The deploy-nested run happens after
merge and is not a merge gate.
