// Synced money columns are int32 cents; forms must refuse more before saving, or sync keeps the
// row local forever. A leaf module to avoid an import cycle.
export const MAX_MONEY_CENTS = 2_147_483_647
