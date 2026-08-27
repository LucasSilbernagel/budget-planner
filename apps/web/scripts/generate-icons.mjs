// Regenerates the raster favicon set from the single source of truth,
// `apps/web/public/favicon.svg`. Run with: `pnpm --filter @budget-planner/web icons:generate`.
//
// Why this exists: browsers still need PNG/ICO fallbacks (legacy tabs, iOS
// apple-touch, Android/PWA maskable) that cannot be authored by hand.
//
// This file is the WRITING half and does nothing else — the rasterization
// helpers live in `icons-lib.mjs`, which is a pure library the unit suite can
// import without any risk of rewriting `public/` as a side effect. It therefore
// runs `main()` unconditionally, exactly as it did before story 40.2: an entry
// point that sometimes declines to run is worse than one that always does,
// because "regenerated nothing, exited 0" is indistinguishable from success.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SQUARE_PNGS,
  publicDir,
  renderIco,
  renderMaskable,
  renderPng,
  sourcePath,
} from './icons-lib.mjs'

async function main() {
  const svg = await readFile(sourcePath)

  for (const { size, name, opaque } of SQUARE_PNGS) {
    await writeFile(join(publicDir, name), await renderPng(svg, size, { opaque }))
  }

  await writeFile(join(publicDir, 'icon-512-maskable.png'), await renderMaskable(svg))
  await writeFile(join(publicDir, 'favicon.ico'), await renderIco(svg))

  process.stdout.write(
    'Generated favicon-16.png, favicon-32.png, apple-touch-icon.png, pwa-192.png, pwa-512.png, icon-512-maskable.png, favicon.ico\n'
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
