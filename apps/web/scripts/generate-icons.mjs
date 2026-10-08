// Always runs main(): "regenerated nothing, exited 0" would look like success. The
// helpers live in icons-lib.mjs so tests can import them without rewriting public/.

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
