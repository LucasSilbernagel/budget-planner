// The Rapids container UI allows one line per env var, so the PEM arrives base64-encoded or
// with escaped `\n`s. No dependencies on purpose: network-free CLIs import it.

const PEM_MARKER = '-----BEGIN'
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/g

export function normalizeCaCert(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }

  const trimmed = raw.trim()
  if (trimmed === '') {
    return undefined
  }

  // Markers present, but newlines may be escaped or collapsed by the single-line field: rewrap.
  if (trimmed.includes(PEM_MARKER)) {
    return rewrapPem(unescapeNewlines(trimmed))
  }

  // `Buffer.from(_, 'base64')` tolerates embedded whitespace.
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
  if (decoded.includes(PEM_MARKER)) {
    return rewrapPem(unescapeNewlines(decoded.trim()))
  }

  // Unrecognised: return the original so the PEM parse error names what the operator set.
  return trimmed
}

function unescapeNewlines(value: string): string {
  return value.includes('\\n') ? value.replace(/\\r\\n|\\n/g, '\n') : value
}

/** Markers on their own lines and the body wrapped at 64 chars, as the PEM parser requires. */
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
