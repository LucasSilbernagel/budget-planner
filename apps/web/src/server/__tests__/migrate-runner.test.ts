/**
 * Tests for the in-cluster migration sequence (Story 5-18, AC-3, AC-4).
 *
 * The runner is the part that must fail LOUDLY: AC-3's release ordering only
 * holds if a non-zero exit from either step becomes a `failed` verdict, and
 * AC-4's preflight guarantee only holds if a refused preflight stops the chain
 * before `drizzle-kit migrate` can touch the schema.
 *
 * `runStep` is injected so the sequencing is tested without spawning anything.
 */

import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error - .mjs module has no type declarations; behaviour is asserted below.
import { MIGRATION_STEPS, runMigration } from '../migrate-runner.mjs'

type Step = { name: string; bin: string; args: string[] }

describe('MIGRATION_STEPS', () => {
  it('runs the preflight before the migration, in that order', () => {
    expect((MIGRATION_STEPS as Step[]).map((step) => step.name)).toEqual(['preflight', 'migrate'])
  })

  // The preflight is the 4-17 clean-slate guard. It has to be the SAME CLI the
  // windowed path ran, or this story would quietly drop a safety check while
  // claiming to preserve it (AC-4).
  it('uses the existing preflight CLI and drizzle-kit, not a reimplementation', () => {
    const [preflight, migrate] = MIGRATION_STEPS as Step[]

    expect(preflight.bin).toBe('tsx')
    expect(preflight.args).toEqual(['src/migrate-preflight-cli.ts'])
    expect(migrate.bin).toBe('drizzle-kit')
    expect(migrate.args).toEqual(['migrate'])
  })
})

describe('runMigration', () => {
  it('succeeds only when every step exits zero', async () => {
    const runStep = vi.fn().mockResolvedValue(0)

    await expect(runMigration({ runStep })).resolves.toMatchObject({ state: 'succeeded' })
    expect(runStep).toHaveBeenCalledTimes(2)
  })

  // The whole point of the preflight: an unsafe target must abort BEFORE a
  // single migration statement runs.
  it('stops at a refused preflight and never reaches drizzle-kit', async () => {
    const runStep = vi.fn().mockResolvedValue(1)

    const result = await runMigration({ runStep })

    expect(result).toMatchObject({ state: 'failed', failedStep: 'preflight', exitCode: 1 })
    expect(runStep).toHaveBeenCalledTimes(1)
    expect((runStep.mock.calls[0]?.[0] as Step).name).toBe('preflight')
  })

  it('reports a failing migration as failed, naming the step and code', async () => {
    const runStep = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(3)

    await expect(runMigration({ runStep })).resolves.toMatchObject({
      state: 'failed',
      failedStep: 'migrate',
      exitCode: 3,
    })
  })

  // A step that dies on a signal reports a null exit code. Treating that as
  // "not non-zero" would read an OOM-killed migration as a success.
  it('treats a signal-killed step as a failure', async () => {
    const runStep = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(null)

    await expect(runMigration({ runStep })).resolves.toMatchObject({
      state: 'failed',
      failedStep: 'migrate',
    })
  })

  it('turns a thrown spawn error into a failed verdict rather than an unhandled rejection', async () => {
    const runStep = vi.fn().mockRejectedValue(new Error('ENOENT: drizzle-kit missing'))

    const result = await runMigration({ runStep })

    expect(result).toMatchObject({ state: 'failed', failedStep: 'preflight' })
    expect(String((result as { error?: string }).error)).toMatch(/ENOENT/)
  })
})
