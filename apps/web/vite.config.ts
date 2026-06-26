import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://tanstack.com/start — the Start plugin owns SSR, the server runtime,
// and file-based route generation. It MUST be registered before the React plugin.
export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
  resolve: {
    // Array form so order is deterministic: more-specific `find`s must precede
    // less-specific ones (rollup/plugin-alias uses the first match).
    alias: [
      // Path aliases for monorepo packages
      { find: '@budget-planner/core', replacement: resolve(__dirname, '../../packages/core/src') },
      { find: '@budget-planner/config', replacement: resolve(__dirname, '../../packages/config/src') },
      // Several server modules import the schema via the package subpath
      // `@budget-planner/db/src/schema` (valid under tsc/node resolution). This
      // more-specific rule must come BEFORE the bare `@budget-planner/db` rule,
      // otherwise the bare alias rewrites it to `packages/db/src/src/schema`.
      { find: '@budget-planner/db/src', replacement: resolve(__dirname, '../../packages/db/src') },
      { find: '@budget-planner/db', replacement: resolve(__dirname, '../../packages/db/src') },
      // Path alias for project-relative imports
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  server: {
    fs: {
      // Allow serving files from the monorepo root (workspace packages)
      allow: [resolve(__dirname, '../../')],
    },
  },
})
