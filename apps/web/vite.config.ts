import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // Path aliases for monorepo packages
      '@budget-planner/core': path.resolve(__dirname, '../../packages/core/src'),
      '@budget-planner/config': path.resolve(__dirname, '../../packages/config/src'),
      '@budget-planner/db': path.resolve(__dirname, '../../packages/db/src'),
    },
  },
  build: {
    // Ensure workspace packages are not bundled
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
