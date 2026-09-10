/**
 * Normalise `DATABASE_CA_CERT` as it arrives from the environment.
 *
 * The Rapids container UI accepts only a SINGLE LINE per env var, but a CA
 * certificate is a multi-line PEM block whose `-----BEGIN CERTIFICATE-----` /
 * `-----END CERTIFICATE-----` delimiters must sit on their own lines for the
 * OpenSSL/Node PEM parser to accept it. Pasting the raw block collapses the
 * newlines and every consumer then fails with an opaque "PEM routines" error
 * while the secret "looks" set.
 *
 * Two single-line-safe encodings are therefore supported, and this function
 * turns either back into a real PEM string:
 *
 *   1. **base64** (recommended) — `base64 -w0 ca.pem`. No escaping, nothing the
 *      shell or the UI can mangle.
 *   2. **escaped newlines** — the PEM on one line with `\n` between each line.
 *
 * A value that already contains a real `-----BEGIN` line is passed through
 * (after collapsing any literal `\n` escapes), so callers handing a genuine
 * multi-line PEM — tests, a local `DATABASE_CA_CERT="$(cat ca.pem)"` — are
 * unaffected. The operation is idempotent.
 *
 * This module has NO dependencies on purpose: `drizzle.config.ts` and the
 * network-free CLIs import it without pulling in `pg` or the schema.
 */

const PEM_MARKER = '-----BEGIN'
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/g

/**
 * @param raw the verbatim `process.env['DATABASE_CA_CERT']` value
 * @returns a real multi-line PEM string, or `undefined` when unset/blank
 */
export function normalizeCaCert(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }

  const trimmed = raw.trim()
  if (trimmed === '') {
    return undefined
  }

  // Already contains PEM markers (possibly with literal `\n` escapes, or with the
  // newlines collapsed to spaces by the Rapids single-line field). `rewrapPem`
  // reconstructs a parser-valid block from whatever whitespace survived — a raw
  // PEM whose newlines were stripped is exactly the mangling this module exists
  // to fix, and passing it through unchanged (the old behaviour) left every
  // consumer failing with an opaque "PEM routines" error.
  if (trimmed.includes(PEM_MARKER)) {
    return rewrapPem(unescapeNewlines(trimmed))
  }

  // Otherwise assume base64-encoded PEM. `Buffer.from(_, 'base64')` tolerates
  // embedded whitespace, so a value that was wrapped before being pasted onto
  // one line still decodes.
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
  if (decoded.includes(PEM_MARKER)) {
    return rewrapPem(unescapeNewlines(decoded.trim()))
  }

  // Neither form recognised: hand back the original so the downstream PEM
  // parse error names the value the operator actually set, rather than a
  // base64-decoded mojibake of it.
  return trimmed
}

function unescapeNewlines(value: string): string {
  return value.includes('\\n') ? value.replace(/\\r\\n|\\n/g, '\n') : value
}

/**
 * Rebuild each `-----BEGIN X----- … -----END X-----` block so the markers sit on
 * their own lines and the body is wrapped at 64 chars — the form OpenSSL/Node's
 * PEM parser requires. Idempotent: an already-valid PEM re-wraps to itself.
 * Falls back to the input unchanged if no complete block is found.
 */
function rewrapPem(value: string): string {
  const blocks: string[] = []
  PEM_BLOCK.lastIndex = 0
  let match: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec-loop form
  while ((match = PEM_BLOCK.exec(value)) !== null) {
    // Both capture groups are guaranteed by the pattern when it matches.
    const label = (match[1] ?? '').trim()
    const body = (match[2] ?? '').replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? ''
    blocks.push(`-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`)
  }
  return blocks.length > 0 ? blocks.join('\n') : value
}
