// Runs last in `pnpm build`, after generate-sw, so sw.js is compressed too and the
// Workbox precache list never sees a sibling.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { precompressDirectory } from './precompress-lib.mjs'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client')
const { files, rawBytes, brBytes, gzipBytes } = await precompressDirectory(clientDir)

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`
process.stdout.write(
	`[precompress] ${files} files: ${kb(rawBytes)} raw, ${kb(gzipBytes)} gzip, ${kb(
		brBytes
	)} brotli\n`
)
