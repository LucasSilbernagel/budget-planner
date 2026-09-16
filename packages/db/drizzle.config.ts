import { resolve } from 'path'
import * as dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'
import { normalizeCaCert } from './src/ca-cert'
import { buildMigrationCredentials } from './src/migrate-credentials'

// Load environment variables from project root .env for LOCAL runs. In
// production nothing reads a .env file — every value is injected as a platform
// secret (see docs/production-database-runbook.md).
dotenv.config({ path: resolve(__dirname, '../../.env') })

const databaseUrl = process.env.DATABASE_URL

// Story 5.17, AC-4: the migrating connection carries the SAME TLS posture and
// host policy as the application pool. drizzle-kit's postgres config accepts
// EITHER `{ url }` OR the decomposed form with `ssl` — never both — so passing a
// bare url, as this file used to, silently gave up CA verification and the
// EU-sovereignty check on the one connection that can rewrite the schema.
//
// Story 5.18, AC-4: the hostname-check waiver that 5.17 needed for the public
// endpoint is gone — migrations run in-cluster, so `verify-full` succeeds with no
// downgrade. `buildMigrationCredentials` now takes no override parameter at all.
//
// `drizzle-kit generate` runs offline and must keep working on a machine with no
// DATABASE_URL, so a MISSING url degrades to an unusable credential set instead
// of throwing here. A url that is present but refused still throws: that is the
// case worth stopping. The migrate path is separately gated by
// `db:migrate:preflight`, which refuses a missing DATABASE_URL outright.
const dbCredentials = databaseUrl
  ? buildMigrationCredentials(
      process.env.NODE_ENV,
      databaseUrl,
      normalizeCaCert(process.env.DATABASE_CA_CERT)
    )
  : { host: '', port: 5432, user: '', password: '', database: '', ssl: false }

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials,
} satisfies Config
