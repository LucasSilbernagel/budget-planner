import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error - .mjs module has no type declarations; behaviour is asserted below.
import { MIGRATION_STEPS, runMigration } from '../migrate-runner.mjs'

type Step = { name: string; bin: string; args: string[] }

describe('MIGRATION_STEPS', () => {
	// One step: preflight and drizzle-kit run inside the lock CLI under one advisory lock.
	it('runs exactly one step, the locked sequence', () => {
		expect((MIGRATION_STEPS as Step[]).map((step) => step.name)).toEqual(['migrate'])
	})

	it('delegates to the lock CLI rather than invoking drizzle-kit directly', () => {
		const [step] = MIGRATION_STEPS as Step[]

		expect(step.bin).toBe('tsx')
		expect(step.args).toEqual(['src/migrate-lock-cli.ts'])
	})

	// Guard against someone "simplifying" the lock back out by calling drizzle-kit
	// straight from the container again.
	it('never spawns drizzle-kit without the lock', () => {
		for (const step of MIGRATION_STEPS as Step[]) {
			expect(step.bin).not.toBe('drizzle-kit')
		}
	})
})

describe('runMigration', () => {
	it('succeeds only when every step exits zero', async () => {
		const runStep = vi.fn().mockResolvedValue(0)

		await expect(runMigration({ runStep })).resolves.toMatchObject({ state: 'succeeded' })
		// Derived from MIGRATION_STEPS so this cannot drift out of sync.
		expect(runStep).toHaveBeenCalledTimes((MIGRATION_STEPS as Step[]).length)
	})

	it('reports a failing migration as failed, naming the step and code', async () => {
		const runStep = vi.fn().mockResolvedValue(3)

		await expect(runMigration({ runStep })).resolves.toMatchObject({
			state: 'failed',
			failedStep: 'migrate',
			exitCode: 3,
		})
	})

	// The lock CLI exits 1 when another pod holds the lock. That must read as a
	// failed release, not a quiet pass.
	it('treats "another pod holds the lock" (exit 1) as a failure', async () => {
		const runStep = vi.fn().mockResolvedValue(1)

		await expect(runMigration({ runStep })).resolves.toMatchObject({
			state: 'failed',
			failedStep: 'migrate',
			exitCode: 1,
		})
	})

	// A step that dies on a signal reports a null exit code; an OOM-killed
	// migration must not read as a success.
	it('treats a signal-killed step as a failure', async () => {
		const runStep = vi.fn().mockResolvedValue(null)

		await expect(runMigration({ runStep })).resolves.toMatchObject({
			state: 'failed',
			failedStep: 'migrate',
		})
	})

	it('turns a thrown spawn error into a failed verdict rather than an unhandled rejection', async () => {
		const runStep = vi.fn().mockRejectedValue(new Error('ENOENT: tsx missing'))

		const result = await runMigration({ runStep })

		expect(result).toMatchObject({ state: 'failed', failedStep: 'migrate' })
		expect(String((result as { error?: string }).error)).toMatch(/ENOENT/)
	})
})
