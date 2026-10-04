# Go-live checklist — Longhand Budget

The executed launch-gate checklist for **Story 5.6**. Every line records what was
actually observed against live production, and by whom. Lines marked
**operator** were executed by Lucas and reported into the story; lines marked
**tooling** were measured in-session and are reproducible with the command shown.

> Provenance rule for this document: a line is only ticked when someone observed
> the result. "Implied by", "should be", and "the code says so" are not ticks.
> Where a clause could not be proven, it says so and names what is missing.

Last executed: **2026-09-16**. Target: `https://www.longhandbudget.com`.

---

## 1. Stack is live (AC-1)

| # | Check | Result | How |
|---|---|---|---|
| 1.1 | SSR app serving on Rapids, Falkenstein DE | ✅ | `danube rapids ls` → `budget-planner-web` running |
| 1.2 | Custom domain + TLS resolves | ✅ | `curl -sI https://www.longhandbudget.com` → 200 |
| 1.3 | TLS certificate valid | ✅ Let's Encrypt, `notAfter=Dec 10 17:41:21 2026 GMT` | `openssl s_client -connect www.longhandbudget.com:443` |
| 1.4 | Apex + `http://` redirect to canonical `https://www.` | ✅ all three forms 301 — `http://longhandbudget.com`, `https://longhandbudget.com`, `http://www.longhandbudget.com` (the latter two probed during code review) | `curl -sI` against each |
| 1.5 | DB reachable over in-cluster TLS | ✅ `/api/ready` → `{"status":"ready"}` | `curl -s .../api/ready` |
| 1.6 | Schema at head | ✅ `0000→0017` applied in-cluster — ⚠️ inferred: the migration-detect step logged `migrate=true … since 2c79fae` and the verdict was `Terminal state: succeeded`; **no log line names 0017** and no schema probe was run | run `35150867103`, migrate job |

## 2. Free tier (AC-2)

| # | Check | Result | How |
|---|---|---|---|
| 2.1 | All 18 routes 200 and hydrated | ✅ | Playwright vs live, `$_TSR` torn down |
| 2.2 | Zero cookies for anonymous visitors | ✅ 0 cookies | real Chromium session |
| 2.3 | No console / page / failed-request errors | ✅ 0 / 0 / 0 | real Chromium session |
| 2.4 | Premium routes show the locked prompt | ✅ | live probe |

## 3. Paid tier (AC-3)

| # | Check | Result | How |
|---|---|---|---|
| 3.1 | Magic-link login → Paddle checkout → webhook → `active` | ✅ **operator** | Lucas, 2026-09-16 |
| 3.2 | Premium features reachable when entitled | ✅ **operator** | Lucas, 2026-09-16 |
| 3.3 | Two real devices: edit on A appears on B | ✅ **operator** | Lucas, 2026-09-16 — retires the 5-15 AC-4 / 4-18 deferral |
| 3.4 | Forged session cookie rejected | ✅ `/api/auth/me` → `{"user":null}` | tooling |
| 3.5 | Cancellation / past-due → downgrade | ⏭️ **carried to 5-19**, not waived | 5-19 rewrites these semantics |

> ⚠️ 3.1–3.3 are an **operator attestation**: no transaction id, webhook payload,
> device pair or DB row was captured into the session record. If the launch file
> needs harder evidence, capture it before close.

## 4. Security & sovereignty (AC-4)

| # | Check | Result | How |
|---|---|---|---|
| 4.1 | Six security headers present on the custom domain | ✅ incl. `strict-transport-security: max-age=31536000; includeSubDomains` | `curl -sI` |
| 4.2 | CSP carries a per-request nonce | ⚠️ a nonce IS present and the allow-list is `cdn.paddle.com` + `cdn.counter.dev` only; **"per-request" was not proven** — that needs two responses with differing nonces | live HTML |
| 4.3 | `session` + `has_session` both `Secure` | ✅ (`has_session` non-HttpOnly by design, 53-1) | logout `Set-Cookie` |
| 4.4 | Legal pages live | ✅ `/privacy` `/terms` `/refund` `/contact` all 200 | `curl` |
| 4.5 | Zero US data residency | ⚠️ two recorded exceptions, **plus counter.dev whose jurisdiction this inventory never states** | inventory below |
| 4.6 | Migration runs with no public DB endpoint | ✅ "No public endpoint was opened" | 5-18; migrate job log |
| 4.7 | Migrator container torn down after migrating | ✅ 0 pods, 0 B (`rapids metrics`); credential stripping evidenced separately by the migrate job's own log line, not by the metrics command | `danube rapids metrics budget-planner-migrator` + run log |

**Residency inventory:** app = Rapids Falkenstein DE · DB = DanubeData PostgreSQL DE
· email = Brevo FR · payments = Paddle UK (MoR, billing only, ADR-003) ·
analytics = counter.dev (ADR-005) · contact form = Formspark (ADR-004, accepted
US-subprocessor exception) · apex redirect = OVH Canada (ADR-007, 301 only, no
app/account/financial data) · error tracking = none provisioned.

⚠️ **counter.dev is the one entry with no jurisdiction recorded.** Every other
service names a country; this one names only an ADR. It is neither positively
cleared as EU nor listed among the two accepted exceptions (Formspark, OVH).
Resolve it before treating 4.5 as closed — it is a live script on every page.

## 5. Observability, rollback, cost (AC-5)

| # | Check | Result | How |
|---|---|---|---|
| 5.1 | Health checks green | ✅ `/api/health` `{"status":"ok"}`, `/api/ready` `{"status":"ready"}` | `curl` |
| 5.2 | Error-rate baseline | ⚠️ **not established** — metrics report `errors: no data`, which is the absence of a series, not an observed zero | `danube rapids metrics budget-planner-web --hours 720` |
| 5.3 | Latency acceptable | ✅ avg 120 ms, max 316 ms (30d) — ⚠️ almost certainly a max-of-averages, not a true worst case; a scale-to-zero cold start is seconds | same |
| 5.4 | Uptime checks provisioned | ✅ **two**, both 300s / threshold 2: `budget-planner-web-health` (`/api/health`, keyword `ok`) and `budget-planner-db-ready` (`/api/ready`, keyword `ready`) | `danube uptime ls` |
| 5.5 | An alert is proven to fire | ✅ **2026-10-04** — detection, recovery **and delivery** proven: a throwaway check's DOWN and recovered emails both reached the account owner's inbox within the minute (story 94.2; see below). Was ⚠️ PARTIAL 2026-09-16 (delivery unproven) | `danube uptime incidents` + received email |
| 5.6 | Rollback tested for real | ✅ rolled back and forward, both via the documented pipeline | see below |
| 5.7 | Scale-to-zero ON | ✅ `--min-scale 0` in `deploy.yml`, and the probe interval was moved 60s → **300s** so the pod can idle between checks | workflow source + `uptime ls` |
| 5.8 | Cost within envelope | ⚠️ Rapids + PG = €12.99/mo, but this is **not** total infra and the memory tier is uncertain — see below | `danube db ls`, metrics |

### 5.5 — what "alert fires" does and does not mean here

⚠️ **Metric alerts are inert for every resource type this project uses.**
`danube alerts available-metrics` reports *"No evaluator is registered"* for
`database`, `cache` and `app`; only `vps` has a working evaluator, and this
project runs no VPS. A Postgres CPU or disk alert would therefore appear
configured on the dashboard and **never fire** — worse than having none. Do not
create one. Uptime checks are the only functioning mechanism.

**Two checks now exist, because one was blind to the database.** `/api/health` is
a liveness probe with **no DB dependency by design**, so with metric alerts inert
a Postgres outage, credential failure or `/api/ready` 503 would have fired
nothing at all. `budget-planner-db-ready` closes that gap.

**What was proven, 2026-09-16.** A throwaway check `bp-synthetic-alert-proof` was
pointed at a 404 route with `--failure-threshold 1`, run to a verdict, then
repointed at `/api/health` to prove recovery, then deleted. Both controls ran
simultaneously, so the mechanism is shown to **discriminate**, not merely to emit:

| Control | Target | Verdict | Incident |
|---|---|---|---|
| Negative | `/__synthetic_alert_probe__` (404) | `down`, `status_mismatch`, 38 ms | opened 17:39:35 |
| Positive | `/api/health` (200) | `up`, 318 ms | none recorded |
| Recovery | negative check repointed at `/api/health` | `up`, 34 ms | **closed 17:42:33** |

(Times as printed by `danube uptime incidents` — **local time**, not the UTC used
by the run IDs elsewhere in this document; the same span is ~21:39–21:42 UTC.)

A full open → close incident lifecycle is therefore on record.

⚠️ **This is a monitor detecting, not yet an alert firing.** The proof ran at
`--failure-threshold 1` on a 60s interval; the permanent checks run at
**threshold 2 on 300s**, so their firing behaviour is extrapolated, not observed
— and the real detection latency is **~10–15 minutes**, not the ~2–3 minutes the
proof exhibited. That is the deliberate cost of keeping scale-to-zero (5.7).

~~⚠️ **Delivery is NOT proven.**~~ *(Superseded 2026-10-04, below.)* As of
2026-09-16 the CLI exposed no notification-channel option (`uptime create` has no
`--channels`; `alerts create` does, but metric alerts have no evaluator here), so
detection, recording and recovery were proven while an actual email landing was not.

**Delivery, 2026-10-04 (story 94.2).** How routing works here: a check's
Settings → Alerts reads *"Who is told, and how, follows each person's notification
settings."* Routing is **per person, account-level**, which is why
`notification_channels` is `null` on every check (the CLI 1.3.0 `uptime`
commands never send that field). It therefore covers all checks equally, and the
live test below is the evidence that it works. The person-level *Notification
preferences* page has **no uptime/monitoring row**; Email is ticked for
Resources → *Status changes* and *Maintenance*. Which row (if either) governs
uptime emails is **unknown**, so leave both ticked. Emails go to the account
owner's login address (personal, deliberately not recorded here), **not**
`hello@longhandbudget.com`.

Throwaway `bp-alert-delivery-proof` (60s, threshold 1), created healthy, then
repointed at the 404 route, then back to `/api/health`, then deleted:

| Control | Target | Verdict | Email |
|---|---|---|---|
| Negative | `/__synthetic_alert_probe__` (404) | `down`, `status_mismatch`; incident opened 21:46:08 UTC | **"Uptime check "bp-alert-delivery-proof" is DOWN"** from `support@danubedata.ro`, inbox, 21:46 UTC |
| Recovery | repointed at `/api/health` | `up`, 200; incident closed 21:53:04 UTC | **"Uptime check "bp-alert-delivery-proof" recovered"**, inbox, 21:53 UTC |
| Positive (×2) | `budget-planner-web-health`, `budget-planner-db-ready` | `up` throughout | **none** (delivery discriminates) |

Not proven: the permanent checks' own emails (they run at threshold 2 on 300s, so
an outage takes ~10–15 min to alert, as above). They share the same per-person
routing by construction. CLI gotcha: `danube uptime update` needs `--name` or it
fails `422 The name field is required`.

The permanent checks `budget-planner-web-health` (`/api/health`, keyword `ok`) and
`budget-planner-db-ready` (`/api/ready`, keyword `ready`) remain in place: **300s**
interval, `2xx` + keyword, failure threshold 2 (measured 2026-10-04).

### 5.6 — rollback, executed 2026-09-16

Both directions ran through the documented pipeline path (§6 of
`.github/DEPLOY_RUNBOOK.md`), not the console shortcut.

| Step | Run | Result |
|---|---|---|
| Roll back to `2c79fae` | `35152551121` | ✅ success — live root bundle changed `index-BMizMwsa.js` → `index-DgJQJXJI.js`; `/api/health` + `/api/ready` stayed 200 |
| Roll forward to `c5931cf` | `35153408347` | ✅ success — bundle restored to `index-BMizMwsa.js`; health + ready 200 |

The rollback is therefore **tested, not merely documented**: production genuinely
served the older build and was genuinely restored, both through the gated
pipeline, with health returning 200 **after** each transition.

⚠️ That is deliberately weaker than "no interruption". Nothing polled *across*
either rollout — the evidence is the pipeline's post-deploy smoke job (one `GET /`
and one `GET /api/health`, ~50 s after the deploy step) plus in-session curls.
Establishing "no interruption" would need a 1–2 s polling loop over the deploy
window recording status and bundle hash, showing the hash flip with zero
non-200s. That was not done.

⚠️ **This rollback crossed a schema change, and what that did and did not prove
needs stating precisely** — an earlier draft of this document overstated it.

Migration `0017` had already been applied by run `35150867103`, 11 minutes
earlier. The rollback then put **old code on the new schema**.

**Corrected 2026-09-16:** an earlier draft claimed the rollback "ran the OLD
image's migrator against the NEW schema". That is **false**. `deploy.yml:804`
sets the migrate job's `IMAGE_TAG: ${{ github.sha }}`; only the deploy job
(1143/1170) honours `inputs.image_tag`. The run log confirms the migrator used
`IMAGE_TAG: c5931cf…` — the **new** image. It no-opped because 0017 was already
recorded in the database's applied-migrations table, i.e. an ordinary idempotent
re-run. **The old-migrator case was never exercised.**

What the schema-crossing rollback therefore establishes: the **DDL** in 0017 is
additive (2 new tables, 3 *nullable* `users` columns, 3 plain indexes), so old
code neither reads nor writes any of it, and the app served correctly on the old
build.

⚠️ What it does **not** establish, and must not be read as establishing:

- 0017 is **not** purely additive. It also runs a data `UPDATE` (rewriting
  `isDefault`/`updatedAt` on existing `userProfiles` rows), and it adds a
  **partial unique index** that constrains a table old code writes.
- At `2c79fae`, `profiles.ts` (`createProfile`, `createDefaultProfileForUser`)
  and `sync.ts` (`updateEntity` spreading a client-pushed `isDefault`) can now
  raise a `23505` unique violation where they previously inserted duplicates.
  That code has **no 23505 handling** — it was added at HEAD. Per 5-19's own
  review, such an error is non-retryable and opens the sync circuit breaker.
- **No write path was exercised during the ~8-minute window**, so there is no
  evidence either way about the above.

Practical risk is low only because this is pre-launch with no third-party users.
The general rule stands unchanged: a rollback across a **destructive** migration
is not safe — roll forward with a fixing migration instead.

### 5.8 — cost envelope

Measured over 30 days (`danube rapids metrics budget-planner-web --hours 720`):

| Resource | Measured / month | Free tier | Used |
|---|---|---|---|
| Requests | ~129,600 | 2,000,000 | 6.5% |
| vCPU-hours | ~2.9 | 69 | 4.2% |
| GiB-hours | ~30.0 | 139 | 21.6% |

Raw figures the table is derived from, so the arithmetic is reproducible:
`requests avg 0.05 req/s · cpu avg 4m · memory avg 42.7 MiB · replicas avg 1.04`
over a 720 h window. Managed PostgreSQL = **€12.99/mo** (`danube db ls`,
tool-verified, not an estimate).

⚠️ **"Total infra = €12.99/mo" is Rapids + Postgres only.** The residency
inventory also lists Brevo (email), Formspark (contact form), counter.dev
(analytics) and the OVH apex redirect, plus domain registration. None is costed
here. Every break-even figure below rests on this partial total.

⚠️ **The memory tier is the real uncertainty, and it interacts with 5.7.**
139 GiB-h ÷ 720 h = a **198 MiB continuous** allowance. Which number that must
cover is unresolved:
- If DanubeData bills **used** memory (~96 MiB per live pod, per `rapids
  metrics`), one always-on pod ≈ 67.5 GiB-h and two ≈ 135 GiB-h — just inside.
- If it bills **allocated** memory (the `small` profile floor is 256 MiB), one
  always-on pod ≈ 184 GiB-h, which **exceeds the 139 GiB-h tier** and Rapids
  stops being €0.

⚠️ **The uptime checks were moved to a 300s interval for exactly this reason.**
At the original 60s the pod never idled — a clean read showed `Live 1 pod` and
`replicas latest 1` continuously, which would have made AC-5's "scale-to-zero
stays ON" false in practice and, under the allocated-memory model, ended
Rapids-at-€0. At 300s the pod can idle between probes. **Re-measure a clean 24 h
window before treating Rapids €0 as settled** — the 30-day figures above predate
both checks and cannot show their effect.

Request-side headroom is unaffected and comfortable: the 2M cap binds at roughly
**15× current traffic**.

⚠️ Two further caveats. The free-tier limits (2M req / 69 vCPU-h / 139 GiB-h)
have **circular provenance** — they appear nowhere but this project's own earlier
notes and have never been checked against DanubeData's published tier. And this
is **pre-launch** traffic (in-session probes, operator testing, CI smoke), so it
is a floor, not a forecast.

### Revenue and break-even

At Paddle Billing's assumed **5% + €0.50** per transaction. VAT is added **on
top** of list prices, and — per code review 2026-09-16 — **Paddle computes its
percentage on the tax-INCLUSIVE total**, so the fee is larger than a naive
5%-of-€39 and varies with the buyer's VAT rate:

| Product | List | VAT-incl. charged (17–27%) | Fee | Net to us | Effective on list |
|---|---|---|---|---|---|
| €39/yr | €39.00 | €45.63 – €49.53 | €2.78 – €2.98 | **€36.02 – €36.22** | 7.1 – 7.6% |
| €99 lifetime | €99.00 | €115.83 – €125.73 | €6.29 – €6.79 | **€92.21 – €92.71** | 6.4 – 6.9% |

(EU VAT spans ~17% Luxembourg to 27% Hungary; VAT itself passes to the tax
authority, so "net to us" is list minus fee.)

Break-even against €155.88/yr, using the **conservative** (27% VAT) ends:
**5 annual** (€180.10), **2 lifetime** (€184.42), or **1 lifetime + 2 annual**
(€164.25). 4 annual = €144.08, still short.

⚠️ **This supersedes an earlier €36.55 / €93.55 table** that applied the fee to
the pre-tax amount. The break-even counts are **unchanged** by the correction —
only the margin narrows. Both the 5% + €0.50 rate and the tax-inclusive base
remain unverified against a real Paddle statement.

⚠️ **Lifetime revenue does not recur.** The sustainable floor is **5 renewing
annual subscribers**, and churn means more than 5 sign-ups to hold 5 active.

⚠️ The **5% + €0.50** rate is still carried from `business-deployment-strategy.md`
and has not been checked against a real Paddle statement.

---

## Open at launch

| Item | Status | Owner |
|---|---|---|
| ~~Alert **delivery** (notification channel + a received email)~~ | ✅ closed 2026-10-04 (94.2): DOWN + recovered emails received; residual: which notification-preference row governs uptime emails is unknown (keep Status changes + Maintenance on) | Lucas / dashboard |
| Paddle fee rate vs a real statement | assumed | Lucas |
| Free-tier limits vs published tier | carried, **circular provenance** | Lucas / dashboard |
| Whether Rapids bills **used** or **allocated** memory | unresolved — decides if Rapids stays €0 | Lucas / dashboard |
| Clean 24 h re-measure now the 300s checks exist | not done | — |
| counter.dev jurisdiction | not recorded in the inventory | Lucas |
| Non-Rapids/PG infra costs (Brevo, Formspark, counter.dev, OVH, domain) | uncosted | Lucas |
| Error-rate baseline (`no data` ≠ zero) | not established | — |
| Stale `production` secret `DANUBEDATA_REGISTRY` shadowing the live variable (F10) | open — safe to delete | Lucas |
| Old-code-on-0017 write paths | never exercised | — |
| Cancellation → downgrade | carried to **5-19** | — |
| Error tracking / APM | deliberately not provisioned | Lucas |
| Harder evidence for 3.1–3.3 | operator attestation only | Lucas |

---

## Review history

**Reviewed 2026-09-16** by a three-layer adversarial pass (Blind Hunter, Edge
Case Hunter, Acceptance Auditor) on a different model from the one that wrote
this document. The review found one **HIGH**: this document had claimed the
rollback "ran the OLD image's migrator against the NEW schema" and called that
verified. It was false — `deploy.yml:804` pins the migrate job to
`${{ github.sha }}`, and the run log confirms the migrator used the new image.
Corrected in §5.6. Several ticks were downgraded to ⚠️ where the evidence
supported a weaker claim than the one written, and the raw measurements behind
§5.8 were added so the arithmetic is reproducible.

The review also **confirmed as true**: all six run IDs and their conclusions,
both bundle fingerprints, every cost and revenue calculation, the secret/variable
inventory, and that no application code changed.
