/**
 * The `version` a forecast is saved with (story 100.1, D4; story 100.2, D10).
 * Version 2 adds `inputs.savingsAccounts`; a v1 row (no rows, `savings` only)
 * still loads, as one `Savings` row (`savingsFromSaved` in the scenario builder).
 * Version 3 adds `inputs.balanceAccounts` (investment and debt rows); a v1/v2 row
 * (`investments` only) still loads, as one `Investments` row (`balanceFromSaved`).
 * Version 4 (story 100.3) adds `annualReturn` on investment rows; a row without
 * one (every v1-v3 forecast) reloads at `DEFAULT_INVESTMENT_RETURN` (6%, D3).
 * Versions 1-4 are detected by field presence.
 * Version 5 (story 102.2, FR170) changes what a debt row MEANS: its payment is
 * cash out while the debt is owed, unless flagged "Payment already in Expenses"
 * (`contributionRecordedAsExpense`); a seeded debt also saves `paidByExpenseName`.
 * A v1-v4 debt row looks the same as an unflagged v5 one, so this is the one
 * change field presence cannot detect: the builder's `balanceFromSaved` READS
 * `version` and reloads every debt of a forecast below 5 flagged (D1), so it
 * projects exactly as it was saved.
 * Version 6 (story 114.1, FR182) adds `inputs.assetAccounts` (`{ name, balance }`
 * rows, always present, possibly empty). A v1-v5 forecast has none and reloads
 * with no asset rows (`assetsFromSaved`). ⚠️ Its "vs. today" (on My Forecasts
 * and in the reopened builder) reads lower by the user's asset total: its
 * projection has no assets, today's baseline does (Q3, accepted pre-launch).
 * Reopening and saving does NOT fix it: a loaded forecast is never seeded, so it
 * saves `assetAccounts: []`. Only adding the asset rows by hand does.
 *
 * Its own module, not `forecast-api.ts`: the page tests replace that module
 * wholesale with `vi.mock`, which would turn this into `undefined`.
 */
export const FORECAST_SAVE_VERSION = 6
