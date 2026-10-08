// Needs Node >= 22.18 / 23.6: it imports the pinned values from a .ts file by type stripping.

import { readFileSync } from 'node:fs'
import {
  PADDLE_CHECKOUT_FRAME_ORIGIN,
  PADDLE_LOADER_STYLE_TEXT,
} from '../src/lib/paddle/paddle-js-internals.ts'
import { PADDLE_JS_URL, checkPaddleJs } from './paddle-drift-lib.mjs'

// Exit 2 = the check could not run; exit 1 = drift. Kept apart so a red run says which.
const FETCH_TIMEOUT_MS = 30_000

const file = process.argv[2]
let source
if (file) {
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    console.error(`Could not read ${file}: ${error instanceof Error ? error.message : error}`)
    process.exit(2)
  }
  console.log(`paddle.js: ${file} (${source.length} chars)`)
} else {
  let response
  try {
    response = await fetch(PADDLE_JS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (error) {
    console.error(
      `Could not fetch ${PADDLE_JS_URL}: ${error instanceof Error ? error.message : error}`
    )
    process.exit(2)
  }
  if (!response.ok) {
    console.error(`Could not fetch ${PADDLE_JS_URL}: HTTP ${response.status}`)
    process.exit(2)
  }
  source = await response.text()
  console.log(
    `paddle.js: ${PADDLE_JS_URL} (${source.length} chars, last-modified ${response.headers.get(
      'last-modified'
    )}, etag ${response.headers.get('etag')})`
  )
}

const { problems, facts } = checkPaddleJs(source, {
  loaderStyleText: PADDLE_LOADER_STYLE_TEXT,
  checkoutFrameOrigins: PADDLE_CHECKOUT_FRAME_ORIGIN,
})
for (const fact of facts) console.log(`  ${fact}`)
if (problems.length) {
  console.error(
    `\nPADDLE.JS DRIFT: ${problems.length} problem(s). Story sec-4 records why each matters.`
  )
  for (const problem of problems) console.error(`\n- ${problem}`)
  process.exit(1)
}
console.log('\nNo drift: every Paddle.js internal the app relies on is unchanged.')
