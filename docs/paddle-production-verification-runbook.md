# Paddle production verification runbook

Operator guide for verifying the live Paddle Billing integration end-to-end
(Story 5-3, AC-4/AC-5). Everything here is **manual verification** against the
real production stack (app on Rapids, managed PostgreSQL, Paddle Billing live
account); the code it exercises is already merged.

---

## 1. Real webhook delivery

1. In the Paddle dashboard, confirm the production webhook is registered at
   `https://<prod-domain>/api/webhooks/paddle` and subscribed to
   `subscription.created` / `subscription.updated` / `subscription.canceled` /
   `transaction.completed` / `transaction.paid` (the handler accepts either
   transaction event — see `routes/api/webhooks/paddle.ts`).
2. Trigger a real event (a live checkout, or Paddle's dashboard "Send test
   event" against the live endpoint) and confirm:
   - the `Paddle-Signature: ts=…;h1=…` header verifies against
     `PADDLE_WEBHOOK_SECRET`,
   - the timestamp-freshness window accepts it,
   - the corresponding `users` row updates (`subscriptionStatus`, `paddleId`).
3. Replay the same payload with a tampered `h1` and confirm a `401`.

## 2. Real checkout, both plans

1. From `/pricing`, complete a checkout for the **annual** plan — a Paddle
   test card in live mode where Paddle supports it, otherwise a real payment
   method (AC-5). Confirm `subscriptionStatus` becomes `active` and the
   server-enforced premium gate flips on for that account on any device
   signed in via the magic-link flow (5.16).
2. Repeat for the **lifetime** plan; confirm `subscriptionStatus` becomes
   `lifetime`.
3. Confirm a forged/tampered session cookie is still rejected (5-7/5-8
   regression).
4. Wallet check: since story sec-4, `Permissions-Policy` ships
   `payment=(self "https://buy.paddle.com")` (`buildPermissionsPolicy` in
   `security-headers.ts`; sandbox deployments also name
   `https://sandbox-buy.paddle.com`), which grants the Payment Request API to
   Paddle's checkout frame. Before sec-4 it was `payment=()`, which disabled it
   (Chrome logged "Permissions policy violation: payment is not allowed"). Note
   whether Apple Pay / Google Pay are offered in the overlay; their availability
   also depends on the Paddle dashboard's payment-method settings and the device.

## 3. Cancellation / past-due

1. Cancel the annual subscription (or simulate `subscription.updated` with a
   `past_due`/`canceled` status) and confirm access downgrades. ✅ 2026-10-04
   (story 94.1, sandbox capture-and-replay): the real `subscription.canceled` →
   `canceled` with `accessEndedAt` set; Paddle's simulated `subscription.past_due` →
   `past_due` (the DB status; that `past_due` closes premium features is
   `STATUS_ACCESS` in `lib/premium/access-statuses.ts`, not re-tested here). The
   simulation ran after the real cancel, so its `data` also carries the real
   `canceled_at` (see the fixtures' `MANIFEST.md`).
2. Confirm a `lifetime` buyer is **never** downgraded by any subscription
   event (25-2 no-downgrade guard). ✅ 2026-10-04 (sandbox replay: four real/simulated
   subscription payloads against a `lifetime` row).

## 3a. Retry, refund and identity behaviour (Story 5-19)

> ✅ **Steps 1-4 VERIFIED 2026-10-04 on Paddle's own SANDBOX payloads (story 94.1, capture-and-replay).**
> Three sandbox checkouts (test card), three refunds, an email change, two subscription simulations
> and a real cancellation generated the events; their payloads were read back from Paddle's
> notification log, scrubbed of emails only (and pretty-printed; the two simulation envelopes and the
> customer-API wrappers were built by us, and one rejected refund is derived: all named in the MANIFEST), committed as fixtures
> (`routes/api/webhooks/__tests__/fixtures/paddle-sandbox/`, see its `MANIFEST.md`) and replayed
> through the real handler on PGlite by
> `routes/api/webhooks/__tests__/paddle-webhook.sandbox-payloads.db.test.ts`.
>
> ⚠️ **It found a real defect, now fixed:** Paddle sends every refund first as `adjustment.created`
> with `status: "pending_approval"`. The handler ignored `status`, so a full refund revoked
> lifetime access at REQUEST time and a refund Paddle later rejected still counted. Since 94.1 a
> refund counts only once `approved` (decision D-A).
>
> **What this does NOT prove:** real delivery or retry timing (the capture destination was
> unreachable on purpose; E2/E3 live delivery was proven earlier); chargeback / chargeback_warning /
> reversal payload shapes (sandbox cannot create a dispute — still our own payloads only); live
> refund approval timing (sandbox auto-approves every ~10 minutes, live refunds can sit pending);
> whether the live destination's `include_sensitive_fields` matches the `false` used for capture.
> Steps 5-7 are NOT re-run against Paddle; see each step.

Everything in this section is covered by automated tests against real
PostgreSQL (`routes/api/webhooks/__tests__/paddle-webhook.db.test.ts`). Since
story 94.1, steps 1-4 are also replayed on Paddle-generated sandbox payloads
(banner above). What is still open is the **live** run: Paddle's real delivery,
retry timing and live approval timing, which no replay can show.

1. **Duplicate delivery.** In the Paddle dashboard, replay a delivered event
   from the notification log. Expect `200`, no change to the `users` row, and
   exactly one row for that `event_id` in `paddleWebhookEvents`. ✅ 2026-10-04
   (sandbox replay of the real `subscription.created`).
2. **Out-of-order retry.** Cancel a subscription, then replay an EARLIER
   `subscription.updated{active}` event for the same customer. Expect `200` and
   the status to stay `canceled` — the ordering watermark
   (`users.entitlementUpdatedAt`) decides, not arrival order. ⚠️ Before 5-19
   this silently re-granted Premium to a cancelled user. ✅ 2026-10-04 (sandbox
   replay: the real `subscription.created` after the real `subscription.canceled`).
3. **Full refund.** Refund a lifetime purchase in full. Expect
   `subscriptionStatus` to move off `lifetime` and the premium gate to close on
   the next request. ✅ 2026-10-04 (sandbox replay, DB status only): access is kept
   while the refund is `pending_approval` and `subscriptionStatus` moves to `canceled`
   when Paddle's `adjustment.updated{approved}` lands.
4. **Partial refund.** Issue a small partial refund against a lifetime purchase
   on a separate test account. Expect access to be RETAINED and exactly one
   `paddleAdjustments` ledger row for that `adj_` id, so the refunded sum for the
   granting transaction equals the partial amount. (Corrected 2026-10-04: there is
   no `users.lifetimeRefundedTotal` column; 5-19's review replaced it with the
   ledger.) ✅ 2026-10-04 (sandbox replay).
5. **Identity collision.** With an account already holding an entitled row for
   `<email>`, complete a checkout for a NEW Paddle customer using that same
   address. Expect a terminal `200` (Paddle must stop retrying), the original
   account untouched, no new `users` row, and an error captured for manual
   reconciliation. ⚠️ Before 5-19 this 500-looped Paddle's full retry schedule
   and the entitlement was never granted.
   Covered by tests, not by Paddle: `paddle-webhook.db.test.ts` › "AC-3 — identity
   reconciliation". Paddle matches a returning email to the SAME customer inside one
   account, so a sandbox collision cannot be produced honestly.
6. **Entitled user cannot re-buy.** Signed in as an `active`/`lifetime` account,
   request `GET /api/paddle/checkout-config`. Expect `403` with no
   `clientToken` in the body, and no checkout offered on `/pricing`.
   Covered by tests: `routes/api/paddle/__tests__/checkout-config.route.test.ts` ›
   "already-entitled guard (5-19 AC-5)".
7. **Zero-value transaction.** ⚠️ Reversed by Story 74.1 (decision
   2026-09-27): a 100%-COUPON transaction on the lifetime price DOES grant
   `lifetime`, recording `lifetimeGrantTotal = 0`. Confirm it grants and that
   the buyer can request a sign-in link. A zero total the discount does not
   cover (no discount, a €0 price, or a partial coupon plus credit) is still
   refused. (Before 74.1 a coupon buyer got a completed checkout and no account.)
   ⚠️ **The coupon IS the abuse control** — the code accepts ANY discount that
   covers the full price. Every 100% coupon must have a **usage limit** and be
   **restricted to the lifetime price** (and ideally an expiry). A coupon grant
   cannot be revoked by refund or chargeback (no money moved); revoke by hand.

✅ **Migration 0017 is applied** (`0017_sad_venus.sql`, deploy run 35150867103,
2026-09-16) — it creates `paddleWebhookEvents`, the `users` watermark/lifetime-
accounting columns, and the `userProfiles_one_default_per_user` partial unique
index. Its `UPDATE` demotes any pre-existing duplicate default profiles; the
index cannot be created while duplicates exist. No longer a prerequisite for the
steps above.

## 4. Authenticated sync round trip

1. On a real paid account, drive an authenticated `/api/sync/*` write, then
   read it back, against the live managed database.
2. While there, diff the live schema (`drizzle-kit`/`\d`) against
   `packages/db/src/schema.ts` to confirm no drift.

## 5. Compliance check

Confirm Paddle (UK Merchant of Record) and DanubeData (Falkenstein, DE)
remain the only two data handlers in the payment/financial-data path, and
that the magic-link sender (`EMAIL_FROM`) is a real Longhand-owned,
Brevo-verified address — not the retired `budgetplanner.eu` domain.

---

## Verification record

| Date | Result |
|------|--------|
| 2026-09-11 | Sandbox checkout confirmed end-to-end (open → pay with test card → `checkout.completed` → `successUrl` redirect) once the sandbox account's default payment link was set. See story 5-3 Dev Agent Record change log. |
| 2026-09-16 | ⏭️ (Steps 1-4 superseded by the 2026-10-04 row.) **§3a NOT verified — accepted-as-skipped by Lucas** on closing story 5-19. No live or sandbox round trip was run for retry idempotency, refund/chargeback revocation, identity collision or the entitled-user 403. Migration 0017 confirmed applied (run 35150867103). Reasoning and residual risk: story 5-19, Task 8. |
| 2026-09-15 | ⚠️ On code BEFORE 5-19 (`c5931cf`, 2026-09-16), which rewrote the subscription semantics; re-verified by story 94.1. Live production round trip confirmed by Lucas: seller account approved, live products/prices/webhook registered, all Paddle + `EMAIL_FROM` secrets injected as Rapids runtime secrets, real webhook delivery verified, real checkout completed for both plans with the premium gate flipping on, cancellation/past-due downgrade and the lifetime no-downgrade guard confirmed, and the authenticated `/api/sync/*` round trip verified against the live managed database. |
| 2026-10-04 | ✅ **§3 and §3a steps 1-4 verified on Paddle-generated SANDBOX payloads** (story 94.1, capture-and-replay): fixtures `routes/api/webhooks/__tests__/fixtures/paddle-sandbox/`, test `paddle-webhook.sandbox-payloads.db.test.ts`. Found and fixed: refunds were applied at `pending_approval` (now only when `approved`). Not proven: retry timing, chargeback shapes, live approval timing, live `include_sensitive_fields`. Steps 5-6 covered by tests only. |
