// Pure library: importing must never write a file, or the favicon test would audit
// freshly regenerated assets against themselves.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
export const sourcePath = join(publicDir, 'favicon.svg')

// Kept in sync with favicon.svg's background rect.
export const ACCENT = '#16a34a'

// pwa-192/pwa-512 are the `any`-purpose manifest icons Chrome requires for
// installability; they keep their alpha.
export const SQUARE_PNGS = Object.freeze([
  { size: 16, name: 'favicon-16.png' },
  { size: 32, name: 'favicon-32.png' },
  // apple-touch must be opaque — iOS composites transparency onto black.
  { size: 180, name: 'apple-touch-icon.png', opaque: true },
  { size: 192, name: 'pwa-192.png' },
  { size: 512, name: 'pwa-512.png' },
])

/**
 * `opaque` flattens the transparent corners onto the accent: iOS composites
 * apple-touch icons onto black.
 */
export async function renderPng(svg, size, { opaque = false } = {}) {
  // Scale density with the target size so small icons stay crisp.
  const pipeline = sharp(svg, { density: Math.max(96, size * 3) }).resize(size, size, {
    fit: 'contain',
  })
  if (opaque) {
    pipeline.flatten({ background: ACCENT })
  }
  return pipeline.png().toBuffer()
}

/** The mark inset into the central ~66% safe zone on a full-bleed accent background. */
export async function renderMaskable(svg) {
  const safeZone = 340
  const inset = await sharp(svg, { density: 1536 }).resize(safeZone, safeZone).png().toBuffer()
  return sharp({ create: { width: 512, height: 512, channels: 4, background: ACCENT } })
    .composite([{ input: inset, gravity: 'center' }])
    .png()
    .toBuffer()
}

/** ICO entries can embed raw PNG data, which keeps this dependency-free. */
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

export async function renderIco(svg) {
  return buildIco([
    { size: 16, data: await renderPng(svg, 16) },
    { size: 32, data: await renderPng(svg, 32) },
  ])
}
