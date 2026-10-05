/**
 * The `version` a forecast is saved with (story 100.1, D4). Version 2 adds
 * `inputs.savingsAccounts`; a v1 row (no rows, `savings` only) still loads, as
 * one `Savings` row (`savingsFromSaved` in the scenario builder).
 *
 * Its own module, not `forecast-api.ts`: the page tests replace that module
 * wholesale with `vi.mock`, which would turn this into `undefined`.
 */
export const FORECAST_SAVE_VERSION = 2
