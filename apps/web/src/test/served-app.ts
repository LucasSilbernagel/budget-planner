// Keep the NAMED `request` import: it binds the original before MSW patches `http`;
// a default import or `fetch` is intercepted. Vite 7 `port: 0` binds 5173, hence freePort.

import { request } from 'node:http'
import { type AddressInfo, createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const SERVED_APP_TIMEOUT_MS = 60_000

export const SERVED_TEST_TIMEOUT_MS = 30_000

// Below the test timeout so a hanging SSR fails as a request error, not a stalled `vite.close()`.
const REQUEST_TIMEOUT_MS = 25_000

export type ServedResponse = {
	status: number
	headers: Record<string, string | string[] | undefined>
	body: string
}

export type ServedApp = {
	origin: string
	get(path: string): Promise<ServedResponse>
	close(): Promise<void>
}

async function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const probe = createNetServer()
		probe.once('error', reject)
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo
			probe.close(() => resolvePort(port))
		})
	})
}

function get(origin: string, path: string): Promise<ServedResponse> {
	return new Promise((resolveResponse, reject) => {
		const req = request(
			new URL(path, origin),
			{ method: 'GET', timeout: REQUEST_TIMEOUT_MS },
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () =>
					resolveResponse({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					})
				)
				res.on('error', reject)
			}
		)
		req.on('timeout', () =>
			req.destroy(new Error(`served app: no response to GET ${path} in ${REQUEST_TIMEOUT_MS} ms`))
		)
		req.on('error', reject)
		req.end()
	})
}

export async function startServedApp(): Promise<ServedApp> {
	// Serve mode has DEV true, so an exported session seed would render a paid session.
	process.env['E2E_SESSION_SEED'] = ''
	const port = await freePort()
	const vite: ViteDevServer = await createServer({
		configFile: resolve(WEB_ROOT, 'vite.config.ts'),
		root: WEB_ROOT,
		logLevel: 'warn',
		// Own dep cache: sharing `node_modules/.vite` makes the e2e dev servers re-optimize mid-test.
		cacheDir: resolve(WEB_ROOT, 'node_modules/.vite-served-app'),
		server: { port, strictPort: true, host: '127.0.0.1', hmr: false, ws: false },
	})
	const origin = `http://127.0.0.1:${port}`
	try {
		await vite.listen()
		// The first SSR compiles the whole graph; warm up so it can't eat the first test's timeout.
		const warmUp = await get(origin, '/')
		if (warmUp.status >= 500) {
			throw new Error(
				`served app: warm-up GET / answered ${warmUp.status}: ${warmUp.body.slice(0, 300)}`
			)
		}
	} catch (error) {
		// `beforeAll` failed, so `afterAll` has nothing to close: release the listener here.
		await vite.close().catch(() => {})
		throw error
	}
	return {
		origin,
		get: (path) => get(origin, path),
		close: () => vite.close(),
	}
}

export function header(response: ServedResponse, name: string): string | undefined {
	const value = response.headers[name.toLowerCase()]
	return Array.isArray(value) ? value.join(', ') : value
}

export function headOf(html: string): string {
	// `<head(\s…)?>`, not `<head[^>]*>`: the latter also opens on `<header …>`.
	const match = html.match(/<head(\s[^>]*)?>([\s\S]*?)<\/head>/)
	if (!match?.[2]) throw new Error('served document has no <head>')
	return match[2]
}

export function bodyOf(html: string): string {
	const index = html.search(/<body[\s>]/)
	if (index === -1) throw new Error('served document has no <body>')
	return html.slice(index)
}
