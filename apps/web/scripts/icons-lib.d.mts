// Types for `icons-lib.mjs`, so the unit suite that audits the committed icon
// binaries can import it without an `@ts-expect-error` blanket (story 40.2
// review). The blanket was worse than useless: `@ts-expect-error` applies to the
// NEXT line only, so on a multi-line import it landed on `import {` while the
// real TS7016 was reported on the module specifier lines below — leaving the
// directive itself unused (TS2578) and suppressing nothing.

export const publicDir: string
export const sourcePath: string
export const ACCENT: string

export interface SquarePng {
  readonly size: number
  readonly name: string
  readonly opaque?: boolean
}
export const SQUARE_PNGS: readonly SquarePng[]

export function renderPng(
  svg: Buffer,
  size: number,
  options?: { opaque?: boolean }
): Promise<Buffer>
export function renderMaskable(svg: Buffer): Promise<Buffer>
export function buildIco(images: { size: number; data: Buffer }[]): Buffer
export function renderIco(svg: Buffer): Promise<Buffer>
