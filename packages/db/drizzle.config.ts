import { resolve } from 'path'
import * as dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'

// Load environment variables from project root .env
// Note: In production, use a proper secrets management system
dotenv.config({ path: resolve(__dirname, '../../.env') })

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  // For production (DanubeData PostgreSQL in EU region only per ADR-001)
  // url: process.env.DATABASE_URL || '',
} satisfies Config
