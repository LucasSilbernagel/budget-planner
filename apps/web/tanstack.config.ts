import { defineConfig } from '@tanstack/start/config'
import type { ServerFunction } from '@tanstack/start'

/**
 * TanStack Start Configuration
 * 
 * Configuration file for TanStack Start Server Functions.
 * Defines server-side routes, middleware, and SSR settings.
 * 
 * Project: Budget Planner
 * Module: Financial Calculations Server Functions
 */

export default defineConfig({
  server: {
    // Define server-side routes for Server Functions
    routes: {
      // Financial calculation endpoints
      '/api/calculations/retirement': {
        method: 'POST',
        handler: async (request: Request) => {
          const { retirementCalculation } = await import('./src/server/functions/financial')
          const body = await request.json()
          return retirementCalculation(request, body)
        },
      },
      '/api/calculations/withdrawal': {
        method: 'POST',
        handler: async (request: Request) => {
          const { safeWithdrawalCalculation } = await import('./src/server/functions/financial')
          const { assets, annualReturnRate } = await request.json()
          return safeWithdrawalCalculation(request, assets, annualReturnRate)
        },
      },
      '/api/calculations/projection': {
        method: 'POST',
        handler: async (request: Request) => {
          const { compoundingProjection } = await import('./src/server/functions/financial')
          const body = await request.json()
          return compoundingProjection(request, body)
        },
      },
      '/api/calculations/net-worth': {
        method: 'POST',
        handler: async (request: Request) => {
          const { netWorthProjection } = await import('./src/server/functions/financial')
          const body = await request.json()
          return netWorthProjection(request, body)
        },
      },
      '/api/calculations/aggregation': {
        method: 'POST',
        handler: async (request: Request) => {
          const { complexAggregation } = await import('./src/server/functions/financial')
          const body = await request.json()
          return complexAggregation(request, body)
        },
      },
      // Balance tracking endpoints (paid tier)
      '/api/data/balance-tracking': {
        method: 'POST',
        handler: async (request: Request) => {
          const functions = await import('./src/server/functions/balanceTracking')
          const body = await request.json()
          const { action, data } = body
          
          switch (action) {
            case 'create':
              return functions.createBalanceTrackingEntry(request, data)
            case 'get':
              return functions.getBalanceTrackingEntries(request)
            case 'update':
              return functions.updateBalanceTrackingEntry(request, data)
            case 'delete':
              return functions.deleteBalanceTrackingEntry(request, data)
            default:
              return { success: false, error: 'Invalid action' }
          }
        },
      },
      // Savings goals endpoints (paid tier)
      '/api/data/savings-goals': {
        method: 'POST',
        handler: async (request: Request) => {
          const functions = await import('./src/server/functions/savingsGoals')
          const body = await request.json()
          const { action, data } = body
          
          switch (action) {
            case 'create':
              return functions.createSavingsGoalServer(request, data)
            case 'get':
              return functions.getSavingsGoalsServer(request)
            case 'update':
              return functions.updateSavingsGoalServer(request, data)
            case 'delete':
              return functions.deleteSavingsGoalServer(request, data)
            default:
              return { success: false, error: 'Invalid action' }
          }
        },
      },
    },
    
    // Server-side middleware for all routes
    middleware: async (request: Request, next: () => Promise<Response>) => {
      // Add security headers
      const response = await next()
      
      // Clone response to modify headers
      const modifiedResponse = new Response(response.body, response)
      
      // Add security headers
      modifiedResponse.headers.set('X-Content-Type-Options', 'nosniff')
      modifiedResponse.headers.set('X-Frame-Options', 'DENY')
      modifiedResponse.headers.set('X-XSS-Protection', '1; mode=block')
      
      // Add CORS headers for development
      if (process.env.NODE_ENV === 'development') {
        modifiedResponse.headers.set('Access-Control-Allow-Origin', '*')
        modifiedResponse.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
        modifiedResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type')
      }
      
      return modifiedResponse
    },
    
    // Server-side context available to all handlers
    context: {
      // Database connection (lazy-loaded)
      get db() {
        return import('@budget-planner/db').then((mod) => mod.db)
      },
    },
  },
  
  // Client-side configuration
  client: {
    // Hydration strategy for SSR
    hydration: {
      // Use fine-grained hydration for better performance
      strategy: 'fine-grained',
    },
  },
  
  // Build configuration
  build: {
    // Output directory for server build
    outDir: 'dist/server',
    
    // Enable source maps for debugging
    sourcemap: true,
    
    // Minification settings
    minify: process.env.NODE_ENV === 'production',
    
    // Tree-shaking for smaller bundles
    rollup: {
      treeshake: true,
    },
  },
  
  // Development server configuration
  dev: {
    // Port for development server
    port: 3000,
    
    // Enable HMR
    hmr: true,
    
    // Open browser on startup
    open: false,
  },
})
