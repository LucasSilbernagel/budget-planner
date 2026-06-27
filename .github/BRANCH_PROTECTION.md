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
gh api -X PUT repos/LucasSilbernagel/budget-planner/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[checks][][context]=Lint (Biome + tsconfig)' \
  -f 'required_status_checks[checks][][context]=Unit tests (Vitest)' \
  -f 'required_status_checks[checks][][context]=E2E tests (Playwright)' \
  -F 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'restrictions=null'
```

## Verify

```sh
gh api repos/LucasSilbernagel/budget-planner/branches/main/protection \
  --jq '.required_status_checks.checks[].context'
```

Then open a PR with a deliberately failing check (e.g. a Biome violation) and
confirm the **Merge** button is blocked until the check passes.
