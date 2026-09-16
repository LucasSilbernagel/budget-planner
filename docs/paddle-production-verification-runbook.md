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
4. Wallet check: `PERMISSIONS_POLICY` ships `payment=()` (`security-headers.ts`),
   which disables the top-document Payment Request API. Card checkout does not
   need it (Paddle's iframe handles entry), but confirm Apple Pay / Google Pay
   still complete a checkout under this policy — if either breaks, relax to
   `payment=(self "https://checkout.paddle.com")`.

## 3. Cancellation / past-due

1. Cancel the annual subscription (or simulate `subscription.updated` with a
   `past_due`/`canceled` status) and confirm access downgrades.
2. Confirm a `lifetime` buyer is **never** downgraded by any subscription
   event (25-2 no-downgrade guard).

## 3a. Retry, refund and identity behaviour (Story 5-19)

> ⏭️ **NOT RUN. Accepted-as-skipped by Lucas on 2026-09-16 when story 5-19 closed.**
> None of the seven steps below has been executed against live or sandbox Paddle.
> They are kept because they remain the right checks — not because they passed.
>
> **Do not read 5-19's `done` status as evidence that any of this behaviour works
> against real Paddle payloads.** The handler is well covered by automated tests,
> but those tests feed it *our* fixtures.
>
> ⚠️ **Highest residual risk: a wrong `adjustment.*` payload-shape assumption.** If
> our assumed shape is wrong, all 25 automated tests still pass and refunds
> silently never revoke — a refunded buyer keeps €99 of access, or a paying
> customer is wrongly revoked. **Steps 3 and 4 are the honest minimum** if anyone
> revisits this; both run in sandbox with no real money.

Everything in this section is covered by automated tests against real
PostgreSQL (`routes/api/webhooks/__tests__/paddle-webhook.db.test.ts`). These
steps confirm the same behaviour against **live Paddle**, where the payload
shapes and retry timing are Paddle's rather than ours — which is precisely the
gap the skip leaves open.

1. **Duplicate delivery.** In the Paddle dashboard, replay a delivered event
   from the notification log. Expect `200`, no change to the `users` row, and
   exactly one row for that `event_id` in `paddleWebhookEvents`.
2. **Out-of-order retry.** Cancel a subscription, then replay an EARLIER
   `subscription.updated{active}` event for the same customer. Expect `200` and
   the status to stay `canceled` — the ordering watermark
   (`users.entitlementUpdatedAt`) decides, not arrival order. ⚠️ Before 5-19
   this silently re-granted Premium to a cancelled user.
3. **Full refund.** Refund a lifetime purchase in full. Expect
   `subscriptionStatus` to move off `lifetime` and the premium gate to close on
   the next request.
4. **Partial refund.** Issue a small partial refund against a lifetime purchase
   on a separate test account. Expect access to be RETAINED and
   `users.lifetimeRefundedTotal` to increase.
5. **Identity collision.** With an account already holding an entitled row for
   `<email>`, complete a checkout for a NEW Paddle customer using that same
   address. Expect a terminal `200` (Paddle must stop retrying), the original
   account untouched, no new `users` row, and an error captured for manual
   reconciliation. ⚠️ Before 5-19 this 500-looped Paddle's full retry schedule
   and the entitlement was never granted.
6. **Entitled user cannot re-buy.** Signed in as an `active`/`lifetime` account,
   request `GET /api/paddle/checkout-config`. Expect `403` with no
   `clientToken` in the body, and no checkout offered on `/pricing`.
7. **Zero-value transaction.** If the dashboard allows a 100%-discount
   transaction on the lifetime price, confirm it does NOT grant `lifetime`.

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
| 2026-09-16 | ⏭️ **§3a NOT verified — accepted-as-skipped by Lucas** on closing story 5-19. No live or sandbox round trip was run for retry idempotency, refund/chargeback revocation, identity collision or the entitled-user 403. Migration 0017 confirmed applied (run 35150867103). Reasoning and residual risk: story 5-19, Task 8. |
| 2026-09-15 | Live production round trip confirmed by Lucas: seller account approved, live products/prices/webhook registered, all Paddle + `EMAIL_FROM` secrets injected as Rapids runtime secrets, real webhook delivery verified, real checkout completed for both plans with the premium gate flipping on, cancellation/past-due downgrade and the lifetime no-downgrade guard confirmed, and the authenticated `/api/sync/*` round trip verified against the live managed database. |
