/**
 * Tests for the migrate container's status server (Story 5-18, AC-3).
 *
 * This is the pipeline's ONLY verdict channel. Readiness deliberately does not
 * encode the migration outcome (story D3): `/healthz` answers "the container
 * booted", and `/migrate-status` answers "what happened", so a failed migration,
 * a broken image and a slow start are three distinguishable signals rather than
 * one indistinguishable `--wait` timeout.
 *
 * Exercised over a real loopback server, not just the listener function, because
 * the bearer check and the 404 fallthrough are the security-relevant parts.
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { http, passthrough } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server as mswServer } from '../../mocks/server'
// @ts-expect-error - .mjs module has no type declarations; behaviour is asserted below.
import { createIdleHealthListener, createMigrateStatusListener } from '../migrate-status.mjs'

const TOKEN = 'a'.repeat(64)

const servers: ReturnType<typeof createServer>[] = []

// These tests drive a real loopback server; MSW's `error` strategy for
// unhandled requests would otherwise reject every one of them.
beforeEach(() => {
  mswServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
})

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
})

/**
 * Send a hand-written request line and return the parsed status + body.
 *
 * Needed because every HTTP client normalises the target before sending: to test
 * what the SERVER does with an odd target, the bytes have to be written directly.
 */
function rawRequest(base: string, requestLine: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(base)
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1', () => {
      socket.write(`${requestLine}\r\nHost: container.invalid\r\nConnection: close\r\n\r\n`)
    })
    let raw = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      raw += chunk
    })
    socket.on('error', reject)
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(raw)?.[1] ?? 0)
      const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      resolve({ status, body })
    })
    setTimeout(() => {
      socket.destroy()
      reject(new Error(`raw request timed out: ${requestLine}`))
    }, 5000).unref()
  })
}

async function startServer(options: Record<string, unknown>): Promise<string> {
  const server = createServer(createMigrateStatusListener(options))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe('createMigrateStatusListener', () => {
  // Without a token the status endpoint would be an open description of the
  // production database's migration state. Refusing at construction means the
  // container fails to boot rather than coming up unguarded.
  it.each([[undefined], [''], ['   ']])(
    'refuses to be constructed without a token (%j)',
    (token) => {
      expect(() =>
        createMigrateStatusListener({ token, readState: () => ({ state: 'running' }) })
      ).toThrow(/MIGRATE_STATUS_TOKEN/)
    }
  )

  it('answers the health path with 200 and no credentials', async () => {
    // Knative's readiness probe carries no Authorization header, so this path
    // must be open — it reveals only that a process is listening.
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'running' }) })
    const response = await fetch(`${base}/healthz`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('honours a custom health path', async () => {
    const base = await startServer({
      token: TOKEN,
      healthPath: '/api/health',
      readState: () => ({ state: 'running' }),
    })

    expect((await fetch(`${base}/api/health`)).status).toBe(200)
    expect((await fetch(`${base}/healthz`)).status).toBe(404)
  })

  it('returns the current state to a correctly authenticated caller', async () => {
    const base = await startServer({
      token: TOKEN,
      readState: () => ({ state: 'succeeded', startedAt: 'A', finishedAt: 'B' }),
    })

    const response = await fetch(`${base}/migrate-status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: 'succeeded',
      startedAt: 'A',
      finishedAt: 'B',
    })
  })

  it('reports a failure verdict with its detail', async () => {
    const base = await startServer({
      token: TOKEN,
      readState: () => ({ state: 'failed', failedStep: 'preflight', exitCode: 1 }),
    })

    const response = await fetch(`${base}/migrate-status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'failed',
      failedStep: 'preflight',
    })
  })

  it.each([
    ['no header at all', undefined],
    ['an empty bearer', 'Bearer '],
    ['the wrong token', `Bearer ${'b'.repeat(64)}`],
    // Length mismatch is the case that makes a naive timingSafeEqual THROW,
    // which would surface as a 500 and read like a broken container.
    ['a shorter token', 'Bearer short'],
    ['a longer token', `Bearer ${'a'.repeat(128)}`],
    ['the token without the scheme', TOKEN],
    ['the wrong scheme', `Basic ${TOKEN}`],
  ])('refuses %s with 401', async (_label, authorization) => {
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'succeeded' }) })

    const response = await fetch(`${base}/migrate-status`, {
      headers: authorization === undefined ? {} : { authorization },
    })

    expect(response.status).toBe(401)
  })

  it('does not leak the state in an unauthorised response body', async () => {
    const base = await startServer({
      token: TOKEN,
      readState: () => ({ state: 'failed', failedStep: 'migrate' }),
    })

    const response = await fetch(`${base}/migrate-status`)

    expect(response.status).toBe(401)
    expect(await response.text()).not.toMatch(/failed|migrate/)
  })

  it('serves nothing else', async () => {
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'running' }) })

    for (const path of ['/', '/api/ready', '/dashboard', '/migrate-status/extra', '/healthz/x']) {
      const response = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
      expect(response.status, `expected 404 for ${path}`).toBe(404)
    }
  })

  // ⚠️ These go over a RAW SOCKET, not `fetch`. Code review 2026-09-15 caught the
  // earlier version asserting nothing: undici normalises `/migrate-status/../healthz`
  // to `/healthz` in the CLIENT before it ever reaches the wire, so the server's
  // own parsing was never exercised and the test passed even against a literal
  // string comparison. Writing the request line by hand is the only way to put an
  // unnormalised target in front of the listener.
  it('resolves dot segments server-side, and cannot traverse into the guarded endpoint', async () => {
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'failed' }) })

    // `..` resolves to the OPEN health path, which reveals no state.
    const toHealth = await rawRequest(base, 'GET /migrate-status/../healthz HTTP/1.1')
    expect(toHealth.status).toBe(200)
    expect(toHealth.body).toContain('"status":"ok"')

    // ...and resolving the other way still hits the bearer check, unauthenticated.
    const toStatus = await rawRequest(base, 'GET /healthz/../migrate-status HTTP/1.1')
    expect(toStatus.status).toBe(401)
    expect(toStatus.body).not.toContain('failed')
  })

  // Node's HTTP parser accepts absolute-form request targets whose authority the
  // WHATWG URL parser rejects, and hands them to the listener verbatim. An
  // unguarded `new URL()` throws there — an UNCAUGHT exception inside a request
  // listener, which exits the process. On this container that means killing a
  // running migration, from an unauthenticated request, on a publicly routable
  // URL that is printed into the run log. Found by code review 2026-09-15.
  it.each([
    ['an out-of-range port', 'GET http://a:99999/ HTTP/1.1'],
    ['a non-numeric port', 'GET http://a:b/ HTTP/1.1'],
    ['an unterminated IPv6 literal', 'GET http://[/ HTTP/1.1'],
    ['a bare percent in the authority', 'GET http://%/ HTTP/1.1'],
  ])('answers 400 for %s instead of crashing the process', async (_label, requestLine) => {
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'running' }) })

    const response = await rawRequest(base, requestLine)

    expect(response.status).toBe(400)

    // The process must still be serving afterwards — that is the actual property.
    const health = await fetch(`${base}/healthz`)
    expect(health.status).toBe(200)
  })

  it('rejects non-GET methods on the status endpoint', async () => {
    const base = await startServer({ token: TOKEN, readState: () => ({ state: 'running' }) })

    const response = await fetch(`${base}/migrate-status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(405)
  })
})

/**
 * The idle listener exists because a permanent migrate container whose credentials
 * have been stripped used to `exit(1)` and crash-loop — revision
 * `budget-planner-migrator-00005`, four restarts, a CrashLoopBackOff email from the
 * platform, 2026-09-16. Nothing was actually wrong; the container just had no way
 * to say "nothing to do".
 */
describe('createIdleHealthListener (unconfigured migrate container)', () => {
  it('answers the health path so the revision goes Ready instead of crash-looping', async () => {
    const server = createServer(createIdleHealthListener({}))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    const response = await fetch(`http://127.0.0.1:${port}/healthz`)

    expect(response.status).toBe(200)
    // `state: idle` so a human reading a probe response can tell the two modes apart.
    await expect(response.json()).resolves.toEqual({ status: 'ok', state: 'idle' })
  })

  it('exposes NO status endpoint — there is no token to guard one with', async () => {
    const server = createServer(createIdleHealthListener({}))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    for (const path of ['/migrate-status', '/', '/api/ready']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(response.status, `expected 404 for ${path}`).toBe(404)
      // Crucially it must not look like a verdict: the pipeline's poll must fail,
      // not read a success from a container that did nothing.
      expect(await response.text()).not.toMatch(/succeeded|state/)
    }
  })

  it('honours a custom health path', async () => {
    const server = createServer(createIdleHealthListener({ healthPath: '/hz' }))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    expect((await fetch(`http://127.0.0.1:${port}/hz`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(404)
  })

  it('survives a malformed request target, like the configured listener', async () => {
    const server = createServer(createIdleHealthListener({}))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    const response = await rawRequest(`http://127.0.0.1:${port}`, 'GET http://a:99999/ HTTP/1.1')
    expect(response.status).toBe(404)

    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
  })
})

/**
 * The entrypoint must choose idle vs configured as a unit: a PARTIAL configuration
 * is a mistake, not a configuration, and migrating on it would be worse than idling.
 */
describe('migrate-entry idle gating (source-level)', () => {
  const entry = readFileSync(new URL('../../../migrate-entry.mjs', import.meta.url), 'utf8')

  it('no longer exits when configuration is missing', () => {
    expect(entry).not.toMatch(/Refusing to start the migrate container/)
    expect(entry).toMatch(/IDLE — not configured to migrate/)
  })

  it('requires all three values together before migrating', () => {
    expect(entry).toMatch(/if \(!token \|\| !databaseUrl \|\| !runId\)/)
  })

  it('serves the idle listener on that branch, and never runs a migration there', () => {
    const idleBranch =
      entry.split('if (!token || !databaseUrl || !runId) {')[1]?.split('} else {')[0] ?? ''
    expect(idleBranch).toMatch(/createIdleHealthListener/)
    expect(idleBranch).not.toMatch(/runMigration/)
  })
})
