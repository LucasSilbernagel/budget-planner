/**
 * The `version` a forecast is saved with (story 100.1, D4; story 100.2, D10).
 * Version 2 adds `inputs.savingsAccounts`; a v1 row (no rows, `savings` only)
 * still loads, as one `Savings` row (`savingsFromSaved` in the scenario builder).
 * Version 3 adds `inputs.balanceAccounts` (investment and debt rows); a v1/v2 row
 * (`investments` only) still loads, as one `Investments` row (`balanceFromSaved`).
 *
 * Its own module, not `forecast-api.ts`: the page tests replace that module
 * wholesale with `vi.mock`, which would turn this into `undefined`.
 */
export const FORECAST_SAVE_VERSION = 3
