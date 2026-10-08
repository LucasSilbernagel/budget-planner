import { resolve } from 'node:path'
import * as dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'
import { normalizeCaCert } from './src/ca-cert'
import { buildMigrationCredentials } from './src/migrate-credentials'

dotenv.config({ path: resolve(__dirname, '../../.env') })

const databaseUrl = process.env.DATABASE_URL

// drizzle-kit takes `{ url }` OR decomposed fields with `ssl`, never both; a bare url drops CA
// verification. A missing url degrades so offline `drizzle-kit generate` still works.
const dbCredentials = databaseUrl
  ? buildMigrationCredentials(
      process.env.NODE_ENV,
      databaseUrl,
      normalizeCaCert(process.env.DATABASE_CA_CERT)
    )
  : { host: '', port: 5432, user: '', password: '', database: '', ssl: false }

// No TimeZone pin here: drizzle-kit strips unknown `dbCredentials` keys, so the migrate step
// gets it through PGOPTIONS.

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials,
} satisfies Config
