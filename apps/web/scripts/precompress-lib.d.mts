// Types for `precompress-lib.mjs`, so the adapter suite
// (`src/server/__tests__/node-adapter.test.ts`) can import it typed (the
// `client-bundle-guard-lib.d.mts` precedent).

export function precompressDirectory(dir: string): Promise<{
  files: number
  rawBytes: number
  brBytes: number
  gzipBytes: number
}>
