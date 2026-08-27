// Rasterization helpers for the favicon set. PURE LIBRARY — importing this
// module must never write a file. The CLI entry point that does the writing is
// `generate-icons.mjs`, which imports from here.
//
// Why the split (story 40.2 review): `src/__tests__/favicon-assets.test.ts`
// audits the committed binaries by re-rendering them from the committed SVG and
// comparing bytes. When the helpers and the `main()` that writes `public/` lived
// in ONE module, that test's import was one `process.argv[1]` comparison away
// from regenerating the very assets it was auditing — after which every
// byte-equality assertion would compare fresh output against fresh output and
// pass forever. Splitting the module removes that failure mode by construction
// instead of guarding against it, and removes the guard that made
// `generate-icons.mjs` a silent no-op when invoked through a symlinked path.
//
// `sharp` is a dev-only dependency: it runs at author time and in the unit
// suite, and the generated binaries are committed, so the client bundle never
// depends on it.
//
// Data sovereignty: all rasterization happens locally; no artwork is uploaded
// to any external service.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
export const sourcePath = join(publicDir, 'favicon.svg')

// Accent green — kept in sync with favicon.svg's background rect.
export const ACCENT = '#16a34a'

// Standard square PNGs used by browser tabs and the iOS home screen.
// pwa-192/pwa-512 are the `any`-purpose PWA manifest icons (story 7-1): Chrome
// and Android require a plain 192 and 512 icon for installability, distinct
// from the maskable 512 below. They keep their alpha (transparent corners) —
// NOT opaque and NOT the maskable safe-zone treatment.
export const SQUARE_PNGS = Object.freeze([
  { size: 16, name: 'favicon-16.png' },
  { size: 32, name: 'favicon-32.png' },
  // apple-touch must be opaque — iOS composites transparency onto black.
  { size: 180, name: 'apple-touch-icon.png', opaque: true },
  { size: 192, name: 'pwa-192.png' },
  { size: 512, name: 'pwa-512.png' },
])

/**
 * Rasterize the source SVG to a square PNG buffer at the given pixel size.
 * When `opaque` is set, the transparent area (the SVG's rounded corners) is
 * flattened onto the accent colour — required for `apple-touch-icon`, which iOS
 * composites onto black rather than the page, so transparent corners would show
 * as black. Browser-tab PNGs keep their alpha so the rounded corners stay clean.
 */
export async function renderPng(svg, size, { opaque = false } = {}) {
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
 * Maskable 512: full-bleed accent background with the source mark inset into
 * the central safe zone (~66%). The source icon's own rounded corners share
 * the accent color, so they blend invisibly into the background — the visible
 * result is just the mark, safely clear of any platform mask crop.
 */
export async function renderMaskable(svg) {
  const safeZone = 340
  const inset = await sharp(svg, { density: 1536 }).resize(safeZone, safeZone).png().toBuffer()
  return sharp({ create: { width: 512, height: 512, channels: 4, background: ACCENT } })
    .composite([{ input: inset, gravity: 'center' }])
    .png()
    .toBuffer()
}

/**
 * Pack one or more square PNG buffers into a multi-resolution .ico.
 * ICO permits embedding raw PNG data per entry (supported by every modern
 * browser and Windows Vista+), which keeps this dependency-free.
 */
export function buildIco(images) {
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

/** Legacy multi-resolution favicon.ico (16 + 32). */
export async function renderIco(svg) {
  return buildIco([
    { size: 16, data: await renderPng(svg, 16) },
    { size: 32, data: await renderPng(svg, 32) },
  ])
}
