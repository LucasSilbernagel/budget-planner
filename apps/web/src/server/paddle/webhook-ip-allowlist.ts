/**
 * Paddle webhook IP allowlist — defense-in-depth ALONGSIDE `Paddle-Signature`
 * HMAC verification, never a replacement for it (story 5-3, live-migration
 * follow-up).
 *
 * Fetches Paddle's current live IP ranges from `https://api.paddle.com/ips`
 * (`data.ipv4_cidrs`) and caches them in memory for `CACHE_TTL_MS` to avoid a
 * network round-trip on every delivery. The list is NEVER hardcoded — Paddle
 * documents this endpoint as the source of truth and says it can change.
 *
 * IPv4 only, matching the endpoint's documented shape (`ipv4_cidrs`, /32
 * entries). An IPv6-derived client IP, or one that fails to parse, does not
 * match anything here — see `isRequestFromPaddleIp`'s enforcement note for why
 * that is not silently fatal.
 */

import { clientIpForRateLimit } from '../rate-limit/client-ip'

interface CachedIpList {
  cidrs: string[]
  fetchedAt: number
}

const PADDLE_IPS_URL = 'https://api.paddle.com/ips'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

let cache: CachedIpList | null = null

async function fetchPaddleIpCidrs(): Promise<string[]> {
  const response = await fetch(PADDLE_IPS_URL)
  if (!response.ok) {
    throw new Error(`Paddle IPs endpoint returned ${response.status}`)
  }
  const body = (await response.json()) as { data?: { ipv4_cidrs?: unknown } }
  const cidrs = body.data?.ipv4_cidrs
  if (!Array.isArray(cidrs) || cidrs.length === 0 || !cidrs.every((c) => typeof c === 'string')) {
    throw new Error('Paddle IPs endpoint returned no usable ipv4_cidrs')
  }
  return cidrs
}

async function getPaddleIpCidrs(): Promise<string[]> {
  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.cidrs
  }
  const cidrs = await fetchPaddleIpCidrs()
  cache = { cidrs, fetchedAt: now }
  return cidrs
}

function ipv4ToUint32(ip: string): number | null {
  const octets = ip.split('.')
  if (octets.length !== 4) return null
  const parsed = octets.map(Number)
  if (parsed.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  return (
    (((parsed[0] as number) << 24) |
      ((parsed[1] as number) << 16) |
      ((parsed[2] as number) << 8) |
      (parsed[3] as number)) >>>
    0
  )
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/')
  const prefix = Number(prefixStr)
  if (!network || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const networkValue = ipv4ToUint32(network)
  const ipValue = ipv4ToUint32(ip)
  if (networkValue === null || ipValue === null) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipValue & mask) === (networkValue & mask)
}

/**
 * Whether `ip` is within one of Paddle's currently published sending ranges.
 * Fails CLOSED (false) if the ranges can't be fetched or `ip` doesn't parse as
 * IPv4 — never silently treat "couldn't check" as "allowed".
 */
export async function isPaddleWebhookIp(ip: string): Promise<boolean> {
  try {
    const cidrs = await getPaddleIpCidrs()
    return cidrs.some((cidr) => ipMatchesCidr(ip, cidr))
  } catch {
    return false
  }
}

/** Test-only: clears the cached IP list so each test starts fresh. */
export function resetPaddleIpCacheForTests(): void {
  cache = null
}

export type WebhookIpCheck = { allowed: boolean; ip: string | null; enforced: boolean }

/**
 * Checks the request's derived client IP against Paddle's published ranges.
 *
 * `allowed` is always the RAW match result (false when no IP is derivable at
 * all) — it is NEVER forced to `true` just because `enforced` is false. That
 * matters: the caller logs `allowed`/`ip` on every request specifically so
 * Lucas can verify, against real delivered webhooks, that they land inside
 * Paddle's ranges in THIS deployment BEFORE flipping enforcement on. Baking
 * enforcement into `allowed` would make that verification impossible — it
 * would always read `true` in observe mode, hiding the one signal the
 * observe-then-enforce workflow depends on. The CALLER is what decides
 * whether `!allowed` actually rejects the request, by also checking
 * `enforced`.
 *
 * ⚠️ DEFAULTS TO OBSERVE-ONLY, NOT ENFORCE (`enforced` reads `false` unless
 * `PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST=true`). This is genuinely new,
 * un-exercised-in-production code sitting in front of the ONE thing that
 * activates a paying customer's subscription. A wrong trusted-proxy-hop
 * count, or a Rapids ingress that doesn't forward client IPs the way this
 * assumes, would silently reject every real Paddle webhook forever — a worse
 * failure than having no IP check at all, and one that would not be caught by
 * anything except a customer noticing they never got Premium.
 */
export async function checkWebhookIp(request: Request): Promise<WebhookIpCheck> {
  const ip = clientIpForRateLimit(request)
  const enforced = process.env['PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST'] === 'true'
  const allowed = ip ? await isPaddleWebhookIp(ip) : false
  return { allowed, ip, enforced }
}
