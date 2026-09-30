// Types for `gates-lib.mjs`, so its unit suite (`src/__tests__/gates-lib.test.ts`)
// can import it typed (the `client-bundle-guard-lib.d.mts` precedent).

export type Summary = Record<string, number>

export type Parser = (text: string) => Summary | null

export interface GateResult {
  id: string
  exitCode: number | null
  summary: Summary | null
  ms: number
  signal?: string | null
  timedOut?: boolean
  interrupted?: boolean
  spawnError?: string | null
  skipped?: string
}

export interface GatePart {
  cwd: string
  command: string
  args: string[]
}

export interface Gate {
  id: string
  phase: 'A' | 'B'
  needsBuild?: boolean
  ports?: number[]
  cwd?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  parts?: GatePart[]
  timeoutMs: number
  parse: { from: string; fn: Parser }
}

export function stripAnsi(text: string): string
export function typeCheckPrograms(script: string): string[][]
export const parseVitestJson: Parser
export function parsePlaywrightJson(text: string, projects?: string[] | null): Summary | null
export const parseBiome: Parser
export const parseTscDiagnostics: Parser
export const parseBundleCheck: Parser
export const parseViteBuild: Parser
export const parseExitOnly: Parser

export function aggregateParts(
  parts: {
    exitCode: number | null
    summary: Summary | null
    signal?: string | null
    timedOut?: boolean
    spawnError?: string | null
  }[]
): {
  exitCode: number | null
  summary: Summary | null
  signal: string | null
  timedOut: boolean
  spawnError: string | null
}

export function verdict(result: {
  exitCode: number | null
  summary: Summary | null
  signal?: string | null
  timedOut?: boolean
  interrupted?: boolean
  spawnError?: string | null
}): { green: boolean; reasons: string[] }

export function formatDuration(ms: number): string
export function formatCounts(summary: Summary | null): string
export function formatLine(result: GateResult): string
export function spawnEnv(
  processEnv: Record<string, string | undefined>,
  gateEnv: Record<string, string> | undefined
): Record<string, string | undefined>

export function buildGates(options: {
  root: string
  runDir: string
  typeCheckScripts: Record<string, string>
  layout?: boolean
}): Gate[]

export function selectGates(gates: Gate[], only: string[] | null): Gate[]

export function typeCheckScriptsOf(
  packages: { dir: string; scripts?: Record<string, string> }[]
): Record<string, string>

export const USAGE: string

export function parseArgs(argv: string[]): {
  sequential: boolean
  only: string[] | null
  help: boolean
  layout: boolean
}

export function treeOf(psTable: string, pid: number): number[]

export function layoutNotice(options: {
  layout: boolean
  e2e: boolean
  changedFiles: string[]
}): string[]
