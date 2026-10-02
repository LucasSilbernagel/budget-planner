// @ts-check
// Build-time static compression for `dist/client` (served by
// `src/server/node-adapter.mjs`). For every compressible file of at least
// MIN_COMPRESS_BYTES it writes a `.br` (quality 11) and a `.gz` (level 9)
// sibling, which the adapter picks by `Accept-Encoding`. Doing it once here
// gives the best ratio at zero per-request CPU.
//
// A sibling that would not be smaller than its file is not written, and any
// existing one is deleted, so a stale sibling from an earlier build can never
// outlive the decision.

import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { constants, brotliCompress, gzip } from 'node:zlib'
import { MIN_COMPRESS_BYTES, PRECOMPRESSED_EXTENSIONS } from '../src/server/node-adapter.mjs'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(path)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

/**
 * @param {string} dir absolute path to `dist/client`
 * @returns {Promise<{ files: number, rawBytes: number, brBytes: number, gzipBytes: number }>}
 */
export async function precompressDirectory(dir) {
  const totals = { files: 0, rawBytes: 0, brBytes: 0, gzipBytes: 0 }
  for await (const path of walk(dir)) {
    if (!PRECOMPRESSED_EXTENSIONS.has(extname(path).toLowerCase())) {
      continue
    }
    const raw = await readFile(path)
    const [br, gzipped] =
      raw.length >= MIN_COMPRESS_BYTES
        ? await Promise.all([
            brotli(raw, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
              },
            }),
            gz(raw, { level: constants.Z_BEST_COMPRESSION }),
          ])
        : [null, null]

    for (const [suffix, data] of /** @type {const} */ ([
      ['.br', br],
      ['.gz', gzipped],
    ])) {
      if (data && data.length < raw.length) {
        await writeFile(path + suffix, data)
      } else {
        await rm(path + suffix, { force: true })
      }
    }
    if (br && gzipped) {
      totals.files += 1
      totals.rawBytes += raw.length
      totals.brBytes += Math.min(br.length, raw.length)
      totals.gzipBytes += Math.min(gzipped.length, raw.length)
    }
  }
  return totals
}
