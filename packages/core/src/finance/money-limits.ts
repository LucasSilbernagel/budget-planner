/**
 * Story 106.1 (FR174): the largest money amount the app can sync, in cents.
 *
 * Every synced money column is a PostgreSQL `integer` (int32 cents): income and
 * expense `amount`; savings `targetAmount`, `currentBalance`,
 * `monthlyAllocation`; balance `currentBalance`, `monthlyContribution`. Core's
 * `syncOperationDataSchema` bounds each of those fields to this value, so an
 * amount above it is refused at enqueue, and `syncBridge` only logs that. The
 * row would stay on this device and never reach the server. So every money form
 * refuses a larger amount BEFORE saving (the only safe refusal point; see the
 * schema-as-gate notes in `sync/types.ts`), using this same constant.
 *
 * ⚠️ A LEAF module on purpose: `services/balanceTracking.ts` needs it, and
 * `sync/types.ts` already imports from `services/balanceTracking.ts`, so
 * defining it in `sync/types.ts` would create an import cycle. Equality with
 * `PG_INT32_MAX` is pinned by a parity test (`money-limits.test.ts`).
 *
 * In the major unit this is 21,474,836.47, or ¥21,474,836 in yen, because every
 * currency is stored ×100.
 */
export const MAX_MONEY_CENTS = 2_147_483_647
