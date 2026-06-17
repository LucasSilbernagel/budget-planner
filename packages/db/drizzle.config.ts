import type { Config } from 'drizzle-kit'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables from project root .env
// Note: In production, use a proper secrets management system
dotenv.config({ path: resolve(__dirname, '../../.env') })

export default {
  schema: './src/schema.ts',
  out: './migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || '',
  },
  // For production (Scaleway PostgreSQL in EU region only per architecture)
  // connectionString: process.env.SCALEWAY_DATABASE_URL || '',
} satisfies Config
