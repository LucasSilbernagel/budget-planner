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
| 2026-09-15 | Live production round trip confirmed by Lucas: seller account approved, live products/prices/webhook registered, all Paddle + `EMAIL_FROM` secrets injected as Rapids runtime secrets, real webhook delivery verified, real checkout completed for both plans with the premium gate flipping on, cancellation/past-due downgrade and the lifetime no-downgrade guard confirmed, and the authenticated `/api/sync/*` round trip verified against the live managed database. |
