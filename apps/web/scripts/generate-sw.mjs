// A post-build step: under TanStack Start's multi-environment build vite-plugin-pwa never
// emits a production sw.js, so run Workbox's generateSW with the shared options.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSW } from 'workbox-build'
import { pwaGlobPatterns, pwaNavigateFallbackDenylist, pwaRuntimeCaching } from '../pwa.config.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(webRoot, 'dist', 'client')

const { count, size, warnings } = await generateSW({
	globDirectory: clientDir,
	globPatterns: pwaGlobPatterns,
	swDest: join(clientDir, 'sw.js'),
	// Take over open pages on activate so a redeploy is never stale; pairs with
	// registerType: 'autoUpdate'.
	clientsClaim: true,
	skipWaiting: true,
	cleanupOutdatedCaches: true,
	// No index.html to precache, so the runtime NetworkFirst route is the offline shell.
	runtimeCaching: pwaRuntimeCaching,
	navigateFallbackDenylist: pwaNavigateFallbackDenylist,
})

for (const warning of warnings) {
	process.stdout.write(`[generate-sw] warning: ${warning}\n`)
}

// Workbox still writes a "successful" sw.js on an empty precache, which would ship a
// broken offline shell.
if (count === 0) {
	process.stderr.write(
		'[generate-sw] ERROR: precached 0 files — dist/client is missing/empty or the glob matched ' +
			'nothing. Refusing to emit an empty service worker (the offline shell would be broken). ' +
			'Ensure `vite build` ran first and emitted dist/client.\n'
	)
	process.exit(1)
}

process.stdout.write(
	`[generate-sw] precached ${count} files, ${(size / 1024).toFixed(1)} KiB → dist/client/sw.js\n`
)
