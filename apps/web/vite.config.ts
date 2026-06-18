// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // Path aliases for monorepo packages
      '@budget-planner/core': resolve(__dirname, '../../packages/core/src'),
      '@budget-planner/config': resolve(__dirname, '../../packages/config/src'),
      '@budget-planner/db': resolve(__dirname, '../../packages/db/src'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the project root
      allow: [resolve(__dirname, '../../')],
    },
  },
  build: {
    // Ensure workspace packages are not bundled
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
