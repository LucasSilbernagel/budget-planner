/**
 * Stub for the optional `pg-native` peer dependency (Story 5-2, AC-1).
 *
 * `pg` declares `pg-native` as an OPTIONAL peer dep — it is only loaded if a
 * caller accesses `pg.native` / constructs a native client. drizzle's
 * `node-postgres` driver uses the pure-JS `Pool`, so the native path is never
 * taken in this app. We do NOT install `pg-native` (it needs libpq native
 * bindings, unwanted in a serverless container).
 *
 * Without this stub, Vite resolves the un-installed optional peer dep to a
 * module whose body is `throw new Error('Could not resolve "pg-native"...')`.
 * That throw executes at module-evaluation time inside the eagerly-loaded
 * server graph (`loadEntries`), crashing EVERY request — SSR, /api/*, health —
 * before any handler runs. Aliasing `pg-native` to this benign empty module
 * removes the throw; the native code path simply never references it.
 */

export default {}
