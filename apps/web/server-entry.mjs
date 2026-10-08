// @ts-check
// Both modes are reached by dynamic import: a static import would load the built app
// server (and its route table) into the migrate container.

import process from 'node:process'

import { selectEntrypoint } from './src/server/entrypoint.mjs'

const mode = selectEntrypoint(process.env)

if (mode === 'migrate') {
  await import('./migrate-entry.mjs')
} else {
  await import('./serve-entry.mjs')
}
