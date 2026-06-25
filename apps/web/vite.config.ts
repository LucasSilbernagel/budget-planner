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
    alias: {
      // Path aliases for monorepo packages
      '@budget-planner/core': resolve(__dirname, '../../packages/core/src'),
      '@budget-planner/config': resolve(__dirname, '../../packages/config/src'),
      '@budget-planner/db': resolve(__dirname, '../../packages/db/src'),
      // Path alias for project-relative imports
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the monorepo root (workspace packages)
      allow: [resolve(__dirname, '../../')],
    },
  },
})
