/**
 * v1-4 and v6 are detected by field presence; v5 changed what a debt payment means, so loaders read
 * `version`. Its own module because page tests vi.mock forecast-api wholesale.
 */
export const FORECAST_SAVE_VERSION = 6
