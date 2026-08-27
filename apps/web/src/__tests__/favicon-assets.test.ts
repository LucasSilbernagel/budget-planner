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

/**
 * Favicon asset guards (story 40.2, AC-3/AC-4/AC-5).
 *
 * WHY THIS EXISTS. Before 40.2 nothing in the repo could tell a REGENERATED
 * raster from a STALE one. `e2e/favicon.spec.ts` asserts the five <link> hrefs
 * resolve 2xx with an `image/*` content type; `e2e/pwa.spec.ts` asserts the
 * manifest's icon SIZES; `src/server/__tests__/node-adapter.test.ts` asserts
 * MIME mapping against synthetic four-byte fixtures it writes itself; and the
 * retired-brand sweep does not scan binaries at all. Every one of those stays
 * green against completely unchanged artwork.
 *
 * That is precisely the regression UX-DR44 names — "ALL eight assets
 * regenerated from the same mark, so no surface keeps the old one" — and the
 * surfaces that rot are the ones nobody looks at: pwa-192, pwa-512, the .ico.
 * A test asserting the files EXIST, are non-empty, or have the right dimensions
 * would pass against the old bytes and is therefore not a guard.
 *
 * THE INVARIANT: every committed raster corresponds to the committed
 * `public/favicon.svg`. It is checked by re-rendering from that SVG through the
 * generator's own helpers and comparing the result to what is on disk. Sharing
 * the helpers is deliberate and is not a tautology: the thing under test is the
 * committed FILE, not the function. If the generator changes, these go red until
 * the binaries are regenerated, which is the correct direction.
 *
 * ⚠️ THE HELPERS COME FROM `icons-lib.mjs`, WHICH WRITES NOTHING. Do not point
 * this import at `generate-icons.mjs`. That module writes `public/` on import,
 * so importing it here would regenerate the very assets this file audits, after
 * which every byte-equality assertion below would compare fresh output against
 * fresh output and pass forever. The two modules are split for exactly this
 * reason (story 40.2 review); the split is what makes the failure mode
 * impossible rather than merely guarded against.
 *
 * COMPARISON IS BYTE EQUALITY, and that choice was forced by a measurement.
 * The first draft compared a 32x32 greyscale signature with a mean-absolute-
 * difference threshold, to tolerate hypothetical libvips/zlib encoder drift.
 * Mutation arm M4 refuted it: moving the tick's endpoint by ONE viewBox unit
 * without regenerating scored 0.72-0.80 and shipped the guard 10/10 GREEN —
 * green against exactly the divergence it exists to catch. Raising the
 * signature resolution did not help (0.68-0.73 at native size); the amplitude,
 * not the resolution, was the problem.
 *
 * What the same measurement showed is that regenerating from an unchanged SVG
 * reproduces the committed PNG BYTE FOR BYTE (difference 0.0000 at every
 * resolution, `Buffer.compare` === 0, all seven assets). The drift the
 * threshold was hedging against is not observable here, so the threshold was
 * pure slack. The signature is kept only to put a magnitude in the failure
 * message — an old-vs-new mark scores ~16, a one-unit nudge ~0.7 — so a red
 * test says how far off the asset is, not merely that it is off.
 *
 * If a future toolchain really does re-encode identical artwork, this goes red
 * LOUDLY on every asset at once, which is a diagnosable failure and is named as
 * such in the failure message. A threshold wide enough to absorb that is wide
 * enough to absorb a real edit, silently.
 *
 * `sharp` is a hard dependency of this file, and therefore of the web unit
 * gate. That is a deliberate, ratified trade: you cannot verify a raster
 * without a rasterizer, and an install with no matching `@img/sharp-*` prebuild
 * (musl, unusual arch, `--no-optional`) failing loudly here is better than a
 * conditional skip that makes the guard silently vanish on some machines.
 */

/** Flatten onto black, downsample, greyscale: a small drift-tolerant fingerprint. */
async function signature(png: Buffer): Promise<Buffer> {
  return (
    sharp(png)
      // Flatten FIRST so alpha differences (e.g. a raster that lost its
      // transparent corners) show up as luminance differences rather than being
      // silently dropped with the alpha channel.
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

/**
 * Byte-identical, with the signature magnitude quoted when it is not.
 *
 * The magnitude is what separates the two causes of a red here, so the
 * diagnostic must never be allowed to throw in place of it: a truncated or
 * corrupt asset makes sharp reject the buffer, and an unhandled sharp error
 * would replace the actionable message with a decoder complaint.
 */
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

/**
 * ICO entries embed raw PNG data, so each can be handed straight to sharp —
 * but only once the container has been validated. An unvalidated parse turns a
 * truncated file, an LFS pointer, or a classic tool's BMP/DIB entries into a
 * raw `ERR_OUT_OF_RANGE` or an "unsupported image format" from sharp, neither
 * of which tells the reader what is actually wrong with the file.
 */
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

/**
 * The complete raster set, in ONE list that drives every staleness check.
 *
 * This shape is the guard, not a convenience. The first draft asserted the
 * five square PNGs by name and then wrote `expect(squares.length + 2).toBe(7)`
 * for the maskable and the .ico — arithmetic that cannot fail once the name
 * list passes, and that nothing ties to the existence of those two checks.
 * Deleting either block left the "complete asset set" guard green. Driving all
 * seven from this list means removing an entry removes its test AND fails the
 * count, which is what makes the count falsifiable.
 */
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
        // Pin the entry set, then compare ENTRY BY ENTRY before the whole file.
        // Two reasons: an .ico that silently lost an entry is stale in a way a
        // whole-file compare reports only as "bytes differ"; and sharp cannot
        // decode an ICO container, so a container-level mismatch yields no
        // signature magnitude at all. The entries are PNGs, so comparing them
        // individually keeps the diagnostic informative.
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

/**
 * Android/Chromium crop a maskable icon to a platform-chosen shape inscribed in
 * a circle of 80% of the icon's width. Anything outside that circle can be cut.
 *
 * This is MEASURED FROM THE RENDERED PIXELS, never from the generator's own
 * `safeZone` inset constant. A check built from the constant the code
 * interpolates is tautological over its content — the exact shape that left
 * story 39.2's CSP pin green while a host was smuggled through it. Mutation arm
 * M3 (see the story's Debug Log) proves the difference: moving the composite
 * off-centre leaves the staleness assertion above GREEN and turns this one RED.
 */
describe('the maskable icon survives the platform safe-area crop (story 40.2, AC-5)', () => {
  const SIZE = 512
  const SAFE_ZONE_FRACTION = 0.8

  it('is fully opaque, so no platform mask reveals the launcher behind it', async () => {
    // Separate from containment on purpose. The containment measurement reads
    // RGB only, so a plate that kept its colour and lost its alpha would sail
    // through it — and the staleness guard would agree, because it re-renders
    // through the same changed helper. Opacity is half of what "maskable"
    // means and nothing else in the repo asserts it.
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

    // Anything measurably off the plate colour is mark — including the
    // anti-aliased fringe, which makes the containment check stricter, not
    // looser. The threshold is a small fraction of the ~250-unit distance
    // between the white mark and the accent plate: wide enough to ignore PNG
    // quantisation of the flat plate (measured: under 3 units), far below the
    // faintest real ink.
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

    // Vacuity guard: a blank plate has no mark pixels and would satisfy
    // containment trivially. Mutation arm M5 covers this.
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

/** The colour covering the most pixels — derived from the image, never from `ACCENT`. */
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

/**
 * A legibility FLOOR, not a legibility proof (story 40.2, AC-4). Contrast and
 * stroke width bound what can be read at 16x16; whether the mark reads as the
 * brand is settled by looking at it, which AC-8 covers. These numbers exist so
 * a future thinner stroke or lower-contrast plate cannot ship silently — the
 * SVG's own comment records why the geometry is pixel-grid aligned.
 *
 * ⚠️ THE THRESHOLD IS 3:1, AND THAT IS THE APPLICABLE STANDARD, NOT A CONCESSION.
 * WCAG 2.1 SC 1.4.11 (Non-text Contrast) requires 3:1 for graphical objects;
 * 4.5:1 is SC 1.4.3, which governs TEXT. White on the brand plate `#16a34a`
 * measures 3.30:1 — it clears the graphical threshold and has never met the
 * text one, the shipped 6-5 mark included. This was found the honest way: the
 * first draft of this test asserted 4.5 and the measurement refuted it.
 *
 * ⚠️ WHAT THE STROKE ASSERTION COVERS IS THE STEM, NOT THE WHOLE MARK. Scanning
 * every row and column of the 16x16 raster: rows 4-9 give solid runs of 2 (the
 * stem and the foot), and columns x9/x11 give runs of 1 — the diagonal tick,
 * which anti-aliases by nature and always will. The pixel-grid alignment claim
 * in favicon.svg is about the AXIS-ALIGNED strokes, and that is what this
 * measures; do not read it as "the narrowest stroke anywhere in the mark".
 */
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

    // The plate is the image's modal colour, NOT a hardcoded pixel. The first
    // draft sampled (3,3), which at 16x16 sits on the `rx=7` corner's
    // anti-aliasing boundary: if a corner change ever put a black-flattened
    // pixel there, the computed ratio would RISE toward white-on-black (~21:1)
    // and this floor would pass while real contrast had fallen. The guard would
    // have loosened exactly when the artwork changed.
    const plate = modalColour(data, info.channels)

    const STEM_ROW = 8
    const row = Array.from({ length: info.width }, (_unused, x) => at(x, STEM_ROW))
    const mark = row.reduce((brightest, pixel) =>
      luminance(pixel) > luminance(brightest) ? pixel : brightest
    )

    // Precondition, so a geometry change that moves the stem off this row fails
    // with "the probe missed" rather than with a false contrast regression.
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

    // ⚠️ SOLID_WHITE encodes "the mark is white", which is an artwork fact
    // rather than a universal one — so the run assertion's message names BOTH
    // things that can move it. An earlier revision asserted the whiteness as a
    // separate PRECONDITION above the run check; mutation arm M6' showed that
    // backfired: thinning the stroke washes the brightest pixel out to 0.91, so
    // the precondition fired first and reported a colour change for what is
    // actually an anti-aliasing regression — the wrong cause for the exact
    // defect this block exists to catch. One assertion, two named causes.
    const SOLID_WHITE = 0.95

    // LONGEST CONTIGUOUS run of SOLID pixels. Both halves are load-bearing and
    // both were established by measurement, not by taste:
    //
    // - Contiguous run, not a count. Row 8 also crosses the tick, so a plain
    //   count of lit pixels reports 4 and stays green on a stem half this wide
    //   (mutation arm M7).
    // - SOLID_WHITE = 0.95, not a permissive 0.7. At stroke-width 4 the stem
    //   renders as literal `255,255,255` (luminance 1.00). At 3.5 it renders
    //   `226,243,232` (0.86) and at 3 — the width the 6-5 mark shipped —
    //   `197,232,210` (0.74): a grey-green wash, not a stroke. A 0.7 cut calls
    //   all three "lit" and passes every one of them, which is how the first
    //   draft of this assertion shipped green under mutation arm M6.
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
