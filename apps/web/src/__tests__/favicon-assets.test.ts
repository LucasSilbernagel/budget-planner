import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SQUARE_PNGS,
  publicDir,
  renderIco,
  renderMaskable,
  renderPng,
  sourcePath,
} from '../../scripts/icons-lib.mjs'

// Import helpers from icons-lib (writes nothing), never generate-icons.mjs: it writes public/ on
// import, so every byte comparison would compare fresh output to itself and pass.

async function signature(png: Buffer): Promise<Buffer> {
  return (
    sharp(png)
      // Flatten first so alpha differences show up as luminance instead of being dropped.
      .flatten({ background: '#000000' })
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer()
  )
}

function meanAbsoluteDifference(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length)
  let total = 0
  for (const [index, value] of a.entries()) total += Math.abs(value - b[index])
  return total / a.length
}

// Never let the diagnostic throw: a corrupt asset makes sharp reject the buffer.
async function expectRegenerated(committed: Buffer, fresh: Buffer, what: string) {
  if (Buffer.compare(committed, fresh) === 0) return

  let magnitude: string
  try {
    const difference = meanAbsoluteDifference(await signature(committed), await signature(fresh))
    magnitude = `signature difference ${difference.toFixed(
      3
    )} (an entirely different mark scores ~16, a one-unit nudge ~0.7; a difference near 0 on EVERY asset at once means toolchain drift — a sharp/libvips version change re-encoding identical artwork — not stale art)`
  } catch (error) {
    magnitude = `bytes differ and the committed file could not be decoded for comparison (${
      error instanceof Error ? error.message : String(error)
    })`
  }

  expect.fail(
    `${what} is not a render of the current favicon.svg: ${magnitude}. Run \`pnpm --filter @budget-planner/web icons:generate\`.`
  )
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function extractIcoEntries(ico: Buffer, label: string): { size: number; data: Buffer }[] {
  expect(ico.length, `${label} is too short to be an ICO`).toBeGreaterThanOrEqual(6)
  expect(ico.readUInt16LE(0), `${label} has a non-zero ICO reserved field`).toBe(0)
  expect(ico.readUInt16LE(2), `${label} is not of ICO image type 1`).toBe(1)

  const count = ico.readUInt16LE(4)
  expect(
    ico.length,
    `${label} declares ${count} entries but is too short to hold them`
  ).toBeGreaterThanOrEqual(6 + count * 16)

  return Array.from({ length: count }, (_unused, index) => {
    const at = 6 + index * 16
    const declared = ico.readUInt8(at)
    const byteLength = ico.readUInt32LE(at + 8)
    const offset = ico.readUInt32LE(at + 12)
    expect(
      offset + byteLength,
      `${label} entry ${index} points past the end of the file`
    ).toBeLessThanOrEqual(ico.length)

    const data = ico.subarray(offset, offset + byteLength)
    expect(
      data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC),
      `${label} entry ${index} is not PNG-encoded — regenerate with \`pnpm --filter @budget-planner/web icons:generate\``
    ).toBe(true)

    return { size: declared === 0 ? 256 : declared, data }
  })
}

// One list drives every check, so removing an entry also fails the count.
const RASTERS: { name: string; render: (svg: Buffer) => Promise<Buffer> }[] = [
  ...SQUARE_PNGS.map((entry) => ({
    name: entry.name,
    render: (svg: Buffer) => renderPng(svg, entry.size, { opaque: entry.opaque }),
  })),
  { name: 'icon-512-maskable.png', render: renderMaskable },
  { name: 'favicon.ico', render: renderIco },
]

let svg: Buffer

beforeAll(async () => {
  svg = await readFile(sourcePath)
})

describe('every committed raster is regenerated from favicon.svg (story 40.2, AC-3)', () => {
  it('checks the complete asset set, so a shrunken list cannot pass vacuously', () => {
    expect(RASTERS.map((entry) => entry.name)).toEqual([
      'favicon-16.png',
      'favicon-32.png',
      'apple-touch-icon.png',
      'pwa-192.png',
      'pwa-512.png',
      'icon-512-maskable.png',
      'favicon.ico',
    ])
  })

  for (const { name, render } of RASTERS) {
    it(`${name} matches a fresh render of the committed SVG`, async () => {
      const committed = await readFile(join(publicDir, name))
      const fresh = await render(svg)

      if (name === 'favicon.ico') {
        // Compare entry by entry first: sharp can't decode an ICO container, so a whole-file
        // mismatch would yield no signature magnitude.
        const committedEntries = extractIcoEntries(committed, 'favicon.ico')
        const freshEntries = extractIcoEntries(fresh, 'a fresh favicon.ico')
        expect(committedEntries.map((entry) => entry.size)).toEqual([16, 32])
        expect(freshEntries.map((entry) => entry.size)).toEqual([16, 32])
        for (const [index, entry] of committedEntries.entries()) {
          await expectRegenerated(
            entry.data,
            freshEntries[index].data,
            `favicon.ico's ${entry.size}x${entry.size} entry`
          )
        }
      } else {
        const metadata = await sharp(committed).metadata()
        expect(metadata.width).toBe(metadata.height)
      }

      await expectRegenerated(committed, fresh, name)
    })
  }
})

// Measured from rendered pixels, never from the generator's `safeZone` constant (tautological).
describe('the maskable icon survives the platform safe-area crop (story 40.2, AC-5)', () => {
  const SIZE = 512
  const SAFE_ZONE_FRACTION = 0.8

  it('is fully opaque, so no platform mask reveals the launcher behind it', async () => {
    // Containment reads RGB only, so a plate that lost its alpha would pass it.
    const { data, info } = await sharp(join(publicDir, 'icon-512-maskable.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    let transparent = 0
    for (let index = 3; index < data.length; index += info.channels) {
      if (data[index] !== 255) transparent++
    }
    expect(transparent, `${transparent} pixels are not fully opaque`).toBe(0)
  })

  it('keeps every mark pixel inside the 80% safe circle', async () => {
    const { data, info } = await sharp(join(publicDir, 'icon-512-maskable.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    expect(info.width).toBe(SIZE)
    expect(info.height).toBe(SIZE)

    const plateRgb = modalColour(data, info.channels)

    // Threshold ignores PNG quantisation of the flat plate (<3 units), far below real ink (~250 away).
    const MARK_DISTANCE = 30
    const centre = (SIZE - 1) / 2
    let markPixels = 0
    let maxRadius = 0

    for (let index = 0; index < data.length; index += info.channels) {
      const pixel = index / info.channels
      const distance = Math.hypot(
        data[index] - plateRgb[0],
        data[index + 1] - plateRgb[1],
        data[index + 2] - plateRgb[2]
      )
      if (distance <= MARK_DISTANCE) continue
      markPixels++
      const radius = Math.hypot((pixel % SIZE) - centre, Math.floor(pixel / SIZE) - centre)
      if (radius > maxRadius) maxRadius = radius
    }

    // A blank plate has no mark pixels and would satisfy containment trivially.
    expect(
      markPixels,
      'no mark pixels found — the containment check would be vacuous'
    ).toBeGreaterThan(0)

    const safeRadius = (SIZE * SAFE_ZONE_FRACTION) / 2
    expect(
      maxRadius,
      `mark reaches ${maxRadius.toFixed(1)}px from centre; the safe circle is ${safeRadius}px`
    ).toBeLessThanOrEqual(safeRadius)
  })
})

function modalColour(data: Buffer, channels: number): number[] {
  const counts = new Map<number, number>()
  for (let index = 0; index < data.length; index += channels) {
    const key = (data[index] << 16) | (data[index + 1] << 8) | data[index + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let plate = 0
  let plateCount = 0
  for (const [key, count] of counts) {
    if (count > plateCount) {
      plate = key
      plateCount = count
    }
  }
  return [(plate >> 16) & 0xff, (plate >> 8) & 0xff, plate & 0xff]
}

// 3:1 is WCAG SC 1.4.11 for graphical objects (4.5:1 is for text). Stroke assertion covers
// the axis-aligned stem only; the diagonal tick always anti-aliases.
describe('the 16x16 raster clears its legibility floor (story 40.2, AC-4)', () => {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((channel) => {
      const value = channel / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  it('renders the mark at >= 3:1 against the plate, with a >= 2px solid axis-aligned stroke', async () => {
    const { data, info } = await sharp(join(publicDir, 'favicon-16.png'))
      .flatten({ background: '#000000' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const at = (x: number, y: number) => {
      const index = (y * info.width + x) * info.channels
      return [data[index], data[index + 1], data[index + 2]]
    }

    // Modal colour, not a fixed pixel: (3,3) sits on the rounded corner's anti-aliasing edge.
    const plate = modalColour(data, info.channels)

    const STEM_ROW = 8
    const row = Array.from({ length: info.width }, (_unused, x) => at(x, STEM_ROW))
    const mark = row.reduce((brightest, pixel) =>
      luminance(pixel) > luminance(brightest) ? pixel : brightest
    )

    expect(
      luminance(mark) - luminance(plate),
      `row ${STEM_ROW} no longer crosses the mark — update the probe coordinates rather than the thresholds`
    ).toBeGreaterThan(0.1)

    const [lighter, darker] = [luminance(mark), luminance(plate)].sort((a, b) => b - a)
    const contrast = (lighter + 0.05) / (darker + 0.05)
    expect(
      contrast,
      `mark/plate contrast at 16x16 is ${contrast.toFixed(
        2
      )}:1. Two things move this: the plate or mark COLOUR changed, or the stroke thinned off the pixel grid so its brightest pixel is anti-aliased rather than solid — check the stroke width before touching the colours.`
    ).toBeGreaterThanOrEqual(3)

    const SOLID_WHITE = 0.95

    // Longest contiguous run, not a count (row 8 also crosses the tick). 0.95 cutoff: thinner
    // strokes render as a grey-green wash (0.86, 0.74) that a 0.7 cut would call lit.
    let run = 0
    let widest = 0
    for (const pixel of row) {
      run = luminance(pixel) > SOLID_WHITE ? run + 1 : 0
      if (run > widest) widest = run
    }
    expect(
      widest,
      `widest solid stroke on row ${STEM_ROW} measures ${widest}px at 16x16 (brightest pixel there: ${luminance(
        mark
      ).toFixed(
        2
      )} luminance). Either the stroke thinned off the pixel grid, or the mark is no longer white — check which before touching the threshold.`
    ).toBeGreaterThanOrEqual(2)
  })
})
