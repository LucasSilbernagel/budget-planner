// Regenerates the raster favicon set from the single source of truth,
// `apps/web/public/favicon.svg`. Run with: `pnpm --filter @budget-planner/web icons:generate`.
//
// Why this exists: browsers still need PNG/ICO fallbacks (legacy tabs, iOS
// apple-touch, Android/PWA maskable) that cannot be authored by hand. `sharp`
// is a dev-only dependency — it runs at author time and the generated binaries
// are committed, so neither CI nor the client bundle ever depends on it.
//
// Data sovereignty: all rasterization happens locally; no artwork is uploaded
// to any external service.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const sourcePath = join(publicDir, 'favicon.svg')

// Accent green — kept in sync with favicon.svg's background rect.
const ACCENT = '#16a34a'

/**
 * Rasterize the source SVG to a square PNG buffer at the given pixel size.
 * When `opaque` is set, the transparent area (the SVG's rounded corners) is
 * flattened onto the accent colour — required for `apple-touch-icon`, which iOS
 * composites onto black rather than the page, so transparent corners would show
 * as black. Browser-tab PNGs keep their alpha so the rounded corners stay clean.
 */
async function renderPng(svg, size, { opaque = false } = {}) {
  // `density` is dots-per-inch for the SVG raster step; scale it with the
  // target size so small icons stay crisp rather than being downscaled from 96dpi.
  const pipeline = sharp(svg, { density: Math.max(96, size * 3) }).resize(size, size, {
    fit: 'contain',
  })
  if (opaque) {
    pipeline.flatten({ background: ACCENT })
  }
  return pipeline.png().toBuffer()
}

/**
 * Pack one or more square PNG buffers into a multi-resolution .ico.
 * ICO permits embedding raw PNG data per entry (supported by every modern
 * browser and Windows Vista+), which keeps this dependency-free.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // image type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length

  for (const [index, image] of images.entries()) {
    const at = index * 16
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, at) // width (0 => 256)
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1) // height
    entries.writeUInt8(0, at + 2) // palette count
    entries.writeUInt8(0, at + 3) // reserved
    entries.writeUInt16LE(1, at + 4) // color planes
    entries.writeUInt16LE(32, at + 6) // bits per pixel
    entries.writeUInt32LE(image.data.length, at + 8) // bytes in resource
    entries.writeUInt32LE(offset, at + 12) // offset from file start
    offset += image.data.length
  }

  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

async function main() {
  const svg = await readFile(sourcePath)

  // Standard square PNGs used by browser tabs and the iOS home screen.
  const squarePngs = [
    { size: 16, name: 'favicon-16.png' },
    { size: 32, name: 'favicon-32.png' },
    // apple-touch must be opaque — iOS composites transparency onto black.
    { size: 180, name: 'apple-touch-icon.png', opaque: true },
  ]
  for (const { size, name, opaque } of squarePngs) {
    await writeFile(join(publicDir, name), await renderPng(svg, size, { opaque }))
  }

  // Maskable 512: full-bleed accent background with the source mark inset into
  // the central safe zone (~66%). The source icon's own rounded corners share
  // the accent color, so they blend invisibly into the background — the visible
  // result is just the arrow, safely clear of any platform mask crop.
  const safeZone = 340
  const inset = await sharp(svg, { density: 1536 }).resize(safeZone, safeZone).png().toBuffer()
  await sharp({ create: { width: 512, height: 512, channels: 4, background: ACCENT } })
    .composite([{ input: inset, gravity: 'center' }])
    .png()
    .toFile(join(publicDir, 'icon-512-maskable.png'))

  // Legacy multi-resolution favicon.ico (16 + 32).
  const ico = buildIco([
    { size: 16, data: await renderPng(svg, 16) },
    { size: 32, data: await renderPng(svg, 32) },
  ])
  await writeFile(join(publicDir, 'favicon.ico'), ico)

  process.stdout.write(
    'Generated favicon-16.png, favicon-32.png, apple-touch-icon.png, icon-512-maskable.png, favicon.ico\n'
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
