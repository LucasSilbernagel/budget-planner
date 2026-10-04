# Paddle sandbox payload fixtures (story 94.1, FR152)

Paddle-generated payloads, captured 2026-10-04 from the Paddle **SANDBOX** account and replayed by
`../../paddle-webhook.sandbox-payloads.db.test.ts` through the real webhook handler on PGlite.

## How they were produced

- Notification destination `ntfset_01m44c1nszmhb5gc4ks1xps75g`, URL `https://bp-94-1-capture.invalid/paddle-webhook`
  (unreachable on purpose), `traffic_source: all`, `api_version: 1`, **`include_sensitive_fields: false`**.
  ⚠️ UNCONFIRMED whether the LIVE destination uses the same `include_sensitive_fields` value; if live is `true`,
  live payloads may carry fields these do not.
- Events: three overlay checkouts with test card 4242 (buyers A, B lifetime €99; S annual €39/yr; country
  Canada, so 13% tax is in every total), three refunds via `POST /adjustments`, one `PATCH /customers` email
  change, two subscription simulations on `sub_S`, one real immediate cancel of `sub_S`.
- Every delivery FAILED (unreachable URL; 3 attempts, status `failed`), and Paddle still kept the full payload:
  each `notification` fixture is `GET /notifications/{id}` → `payload`, byte-for-byte as the API returned it
  (verified by length + FNV-1a computed in the API session), then pretty-printed. Key order is Paddle's.
- Sandbox auto-approved all three refunds at 21:20 UTC, ~7 minutes after creation.

## Scrubbing (AC 3)

The ONLY content change in any fixture: the four buyer addresses `bp-94-1-{a,b,s,s-new}` at domain `example.com` (what
the checkouts used) → the same local part at `example.test` (same address everywhere, including `customer-*.json`). Nothing else was edited. There were no
names, address lines, postal codes or IPs in these payloads (`include_sensitive_fields: false`; the address is an
`add_…` id only). `cardholder_name` is `"Test Buyer"`, typed by the agent, kept as an obvious test value.

## Fixtures

| file | event_type | occurred_at (UTC) | source | Paddle id | notes |
|---|---|---|---|---|---|
| 01-transaction.paid-lifetime-A.json | transaction.paid | 2026-10-04T21:11:40.266548Z | notification | ntf_01m44c46k7qwr7phmwmxth08yh | evt_01m44c45zab5kr3pe7sdvrh5cm |
| 02-transaction.completed-lifetime-A.json | transaction.completed | 21:11:41.859203Z | notification | ntf_01m44c47y2d9r8pvxjf438aejd | grand_total 11187 |
| 03-transaction.paid-lifetime-B.json | transaction.paid | 21:12:00.588990Z | notification | ntf_01m44c4t3q82r8q3sg80f4sepz | |
| 04-transaction.completed-lifetime-B.json | transaction.completed | 21:12:02.220237Z | notification | ntf_01m44c4vwz8t1xy8kffmkmgpjf | |
| 05-transaction.paid-annual-S.json | transaction.paid | 21:12:17.408167Z | notification | ntf_01m44c5am6p37j6bhvnnbxq57m | `subscription_id` null on `.paid` |
| 06-subscription.created-annual-S.json | subscription.created | 21:12:17.838253Z | notification | ntf_01m44c5b4msnn468zsdnab9zh2 | sub_01m44c5aghs7tzh0fw6egh1zze |
| 06a-subscription.activated-annual-S.json | subscription.activated | 21:12:17.838253Z | notification | ntf_01m44c5b5b7tdx930471pvcjr5 | `status: active`; same `occurred_at` as 06. Added after review (D1), read-only capture 2026-10-04 |
| 07-transaction.completed-annual-S.json | transaction.completed | 21:12:18.757841Z | notification | ntf_01m44c5byc4enx284z9cbw1saw | |
| 08-adjustment.created-full-refund-A.json | adjustment.created | 21:12:44.959458Z | notification | ntf_01m44c65n7sv1b78e8qjzs1hec | `status: pending_approval` |
| 09-adjustment.created-partial-refund-B.json | adjustment.created | 21:12:45.142730Z | notification | ntf_01m44c65nmdnrwqtjtb2yqcn59 | `pending_approval`, total 1000 |
| 10-adjustment.created-refund-annual-S.json | adjustment.created | 21:12:45.327478Z | notification | ntf_01m44c65xrpasyhgy3rjmbkpz1 | `pending_approval`, total 500 |
| 11-customer.updated-S.json | customer.updated | 21:12:55.384350Z | notification | ntf_01m44c6fn43s265newcd420z3a | new email |
| 12-subscription.canceled-annual-S.json | subscription.canceled | 21:17:40.267777Z | notification | ntf_01m44cf5ya30j6chska7hdxd4r | real immediate cancel |
| 12a-subscription.updated-canceled-annual-S.json | subscription.updated | 21:17:40.267777Z | notification | ntf_01m44cf5z9fjr6qkfadbgqh21q | `status: canceled`; same `occurred_at` as 12. Added after review (D1) |
| 13-subscription.updated-active-annual-S.sim.json | subscription.updated | 21:19:23.103567Z | simulation | ntfsimevt_01m44cj9yzj22q52aevabvsx2d | see "Simulation fixtures" |
| 14-subscription.past_due-annual-S.sim.json | subscription.past_due | 21:19:23.157722Z | simulation | ntfsimevt_01m44cja0nydcn7ew9y8nvp4cf | see "Simulation fixtures" |
| 15-adjustment.updated-full-refund-A.json | adjustment.updated | 21:20:01.498741Z | notification | ntf_01m44ckg0phsgy2715gbqx0cxj | `status: approved` |
| 16-adjustment.updated-partial-refund-B.json | adjustment.updated | 21:20:02.177834Z | notification | ntf_01m44ckgh929hnfdkn06gyzvkz | `approved` |
| 17-adjustment.updated-refund-annual-S.json | adjustment.updated | 21:20:03.262294Z | notification | ntf_01m44ckhhdtgfsbr9bgfcsbtfz | `approved` |
| 90-adjustment.updated-full-refund-A.REJECTED.derived.json | adjustment.updated | (as 15) | **DERIVED** | from ntf_01m44ckg0phsgy2715gbqx0cxj | copy of 15 with `data.status` → `rejected` and, since the 94.1 code review, its own `event_id` (`evt_derived_rejected_from_fixture_15`) so it can never be deduplicated against 15 (sandbox cannot reject a refund; AC 7 iii) |
| customer-A.json / -B.json / -S.json | — | — | API | `GET /customers/{id}` | the SDK returns the entity; wrapped as `{ "data": … }` (the HTTP body shape), `meta` omitted. S was read AFTER its email change. |

All dated 2026-10-04 (capture date 2026-10-04).

## `event_id` per fixture (AC 1)

| file | `event_id` |
|---|---|
| 01-transaction.paid-lifetime-A.json | `evt_01m44c45zab5kr3pe7sdvrh5cm` |
| 02-transaction.completed-lifetime-A.json | `evt_01m44c47h39t85cp881ckpmcdz` |
| 03-transaction.paid-lifetime-B.json | `evt_01m44c4stcrpjhqv1sa9yyzdz2` |
| 04-transaction.completed-lifetime-B.json | `evt_01m44c4vdcnn8edmg2nxj8gmw6` |
| 05-transaction.paid-annual-S.json | `evt_01m44c5a80tnx53q5khcc8zbbe` |
| 06-subscription.created-annual-S.json | `evt_01m44c5anesvky0beemvhpskzm` |
| 06a-subscription.activated-annual-S.json | `evt_01m44c5aneg7ydb6xhf97668nn` |
| 07-transaction.completed-annual-S.json | `evt_01m44c5bj5wehqygrfhxfsnppf` |
| 08-adjustment.created-full-refund-A.json | `evt_01m44c654zeb56emdsensa2fx3` |
| 09-adjustment.created-partial-refund-B.json | `evt_01m44c65ap7qgx7qammn1spmcq` |
| 10-adjustment.created-refund-annual-S.json | `evt_01m44c65gfrne9yvka0xnp7kqk` |
| 11-customer.updated-S.json | `evt_01m44c6farxgdajch6pxfnsb1k` |
| 12-subscription.canceled-annual-S.json | `evt_01m44cf5hb99ypbrvk4tzkbhs7` |
| 12a-subscription.updated-canceled-annual-S.json | `evt_01m44cf5hb5pq39td24pj0h3p2` |
| 13-subscription.updated-active-annual-S.sim.json | `ntfsimevt_01m44cj9yzj22q52aevabvsx2d` |
| 14-subscription.past_due-annual-S.sim.json | `ntfsimevt_01m44cja0nydcn7ew9y8nvp4cf` |
| 15-adjustment.updated-full-refund-A.json | `evt_01m44ckfet2dyhf74weepaj42f` |
| 16-adjustment.updated-partial-refund-B.json | `evt_01m44ckg41wa2am348dav58ema` |
| 17-adjustment.updated-refund-annual-S.json | `evt_01m44ckh5y1btwjxrrsbmvc7em` |
| 90-adjustment.updated-full-refund-A.REJECTED.derived.json | `evt_derived_rejected_from_fixture_15` |

Scrubbing per fixture: only `11-customer.updated-S.json` and `customer-{A,B,S}.json` contain an address
(`example.com` → `example.test`); no other event fixture carries an email, so their only change is pretty-printing.
13/14 also got the envelope described below; `customer-*.json` were wrapped as described in the table above; 90's
changes are in its row.

## Simulation fixtures

Scenario simulations `ntfsim_01m44cj6h3fkcvgywgfymx2qrb` (subscription_renewal, `payment_outcome: failed`) and
`ntfsim_01m44cj6rtncj975fkm58wk2g4` (subscription_cancellation, `has_past_due_transaction: true`), populated from
the real `sub_S`. They ran AFTER the real cancel of `sub_S` (the permission arrived late), so their `data` carries
`canceled_at` from the real cancel alongside the simulated `status` — the handler does not read `canceled_at`.
Every simulated delivery was `aborted` (the destination is unreachable), and a simulation run event exposes only
`data`, with no envelope. For 13 and 14 the `data` object is Paddle's, untouched; **the envelope was built by us**:
`event_id` = the run-event id (`ntfsimevt_…`), `occurred_at` = the run event's `created_at`, `notification_id: null`.
Simulated events are timestamped at simulation time, so 13 (`active`) is LATER than the real cancel (12).

## NOT CAPTURED (stay covered by the hand-built cases in `paddle-webhook.db.test.ts` only)

- `chargeback` — NOT CAPTURED: Paddle creates chargebacks only from a real card dispute; sandbox cannot produce one.
- `chargeback_warning` — NOT CAPTURED: same reason.
- `chargeback_reverse` — NOT CAPTURED: needs a dispute won; not producible in sandbox.
- `credit_reverse` — NOT CAPTURED: not producible in sandbox for these checkouts (no credit adjustments).
- `rejected` refund — NOT CAPTURED as a real payload (sandbox approves every refund); covered by the DERIVED 90.

Also captured in Paddle's log but not committed: `customer.created` ×3 (unhandled by the handler, 200
"unhandled"), and the other simulation events. `subscription.activated` (06a) and the real
`subscription.updated{canceled}` (12a) were missed in the first pass (the code review found it) and added by a
READ-ONLY notification-log pass on 2026-10-04 (Lucas, review decision D1): same length + FNV-1a check as the
others, no address in either, so their only change is pretty-printing. The only `subscription.updated{active}`
fixture is still the simulated 13; 06a is Paddle's real `active` event for the same subscription.
