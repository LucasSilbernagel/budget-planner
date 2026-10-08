// Allow-list of permanent failures: outcomes that depend on nothing but the op's own data.
// Anything unlisted stays queued (FK, unique and transient errors can clear on replay).

// Never the driver's message: it names tables and columns, so it goes to the log.
export type SyncRejectionReason = 'constraint' | 'invalid'

export interface SyncRejection {
  operationId: string
  reason: SyncRejectionReason
}

const PERMANENT_SQLSTATES: ReadonlyMap<string, SyncRejectionReason> = new Map([
  // Op-data only because every CHECK is single-column; a multi-column CHECK would need re-arguing.
  ['23514', 'constraint'],
  // Amounts have no int32 bound on the server gate, so an overflow is the op's own value.
  ['22003', 'invalid'],
])

// The code is on the thrown error itself, not a wrapped cause, in PGlite and node-postgres.
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

// `error.constraint`, not `constraint_name`, in PGlite and node-postgres.
export function constraintOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined
  const constraint = (error as { constraint?: unknown }).constraint
  return typeof constraint === 'string' ? constraint : undefined
}

export function permanentRejectionReason(error: unknown): SyncRejectionReason | undefined {
  const code = sqlStateOf(error)
  return code === undefined ? undefined : PERMANENT_SQLSTATES.get(code)
}
