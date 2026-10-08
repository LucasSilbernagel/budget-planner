// @vitest-environment node

import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		get db() {
			return holder.db
		},
	}
})

vi.mock('@/lib/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/server/api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

import { userProfiles, users } from '@budget-planner/db'
import { logger } from '@/lib/logger'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { migratedPglite } from '../../../test/pglite-migrated'
import { GET, PROFILES_PREMIUM_ERROR } from '../profiles'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

let pg: PGlite
let db: ReturnType<typeof drizzle>

const sessionMock = getCurrentUserSession as unknown as ReturnType<typeof vi.fn>
const req = () => new Request('https://app.test/api/profiles')

function signedIn(subscriptionStatus: string) {
	sessionMock.mockResolvedValue({
		success: true,
		data: {
			userId: USER,
			email: 'a@example.test',
			paddleId: 'ctm_a',
			subscriptionStatus,
			currency: 'NONE',
			billingInterval: null,
			isAuthenticated: true,
		},
	})
}

beforeAll(async () => {
	pg = await migratedPglite()
	db = drizzle(pg)
	holder.db = db
	await db.insert(users).values([
		{ id: USER, email: 'a@example.test', paddleId: 'ctm_a', subscriptionStatus: 'active' },
		{ id: OTHER, email: 'b@example.test', paddleId: 'ctm_b', subscriptionStatus: 'active' },
	])
}, 60_000)

afterAll(async () => {
	await pg?.close()
})

beforeEach(async () => {
	vi.clearAllMocks()
	holder.db = db
	await db.delete(userProfiles)
	signedIn('active')
})

describe('GET /api/profiles', () => {
	it("lists the caller's LIVE profiles, oldest first, and nobody else's", async () => {
		await db.insert(userProfiles).values([
			{
				id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				userId: USER,
				name: 'Second',
				isDefault: false,
				createdAt: new Date('2021-01-01'),
			},
			{
				id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
				userId: USER,
				name: 'First',
				isDefault: true,
				createdAt: new Date('2020-01-01'),
			},
			{
				id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
				userId: USER,
				name: 'Tombstone',
				isDefault: false,
				isDeleted: true,
			},
			{
				id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
				userId: OTHER,
				name: 'Theirs',
				isDefault: true,
			},
		])

		const res = await GET({ request: req() })
		expect(res.status).toBe(200)
		expect(res.headers.get('cache-control')).toBe('no-store')
		const body = (await res.json()) as {
			success: boolean
			data: { name: string; isDefault: boolean }[]
		}
		expect(body.success).toBe(true)
		expect(body.data.map((p) => [p.name, p.isDefault])).toEqual([
			['First', true],
			['Second', false],
		])
	})

	it('an account with no profile gets an empty list (the page’s `none` arm), not an error', async () => {
		const res = await GET({ request: req() })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: [] })
	})

	it('an unresolvable session is 503, with no driver detail in the body', async () => {
		sessionMock.mockResolvedValue({ success: false, error: 'DATABASE_URL is not configured.' })
		const res = await GET({ request: req() })
		expect(res.status).toBe(503)
		expect(await res.json()).toEqual({
			success: false,
			error: 'Your session could not be checked. Try again in a moment.',
		})
	})

	it('no session is 401', async () => {
		sessionMock.mockResolvedValue({ success: true, data: null })
		const res = await GET({ request: req() })
		expect(res.status).toBe(401)
		expect(res.headers.get('cache-control')).toBe('no-store')
		expect(await res.json()).toEqual({ success: false, error: 'Authentication required' })
	})

	it.each(['free', 'past_due', 'canceled'])(
		'a %s status is 403 with the premium message',
		async (status) => {
			signedIn(status)
			const res = await GET({ request: req() })
			expect(res.status).toBe(403)
			expect(await res.json()).toEqual({ success: false, error: PROFILES_PREMIUM_ERROR })
		}
	)

	it('lifetime is let through', async () => {
		signedIn('lifetime')
		expect((await GET({ request: req() })).status).toBe(200)
	})

	it('an unexpected failure is a 500 with a fixed message; the detail goes to the log', async () => {
		holder.db = new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === 'select') throw new Error('connection reset by peer')
				return Reflect.get(target, prop, receiver)
			},
		})
		const res = await GET({ request: req() })
		expect(res.status).toBe(500)
		expect(await res.json()).toEqual({ success: false, error: 'Failed to load profiles' })
		expect(vi.mocked(logger.error)).toHaveBeenCalledWith('[api/profiles] GET failed', {
			error: 'connection reset by peer',
		})
	})
})
