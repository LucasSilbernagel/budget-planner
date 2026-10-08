/** Three gates the compiler can't check. A uuid matching no expense is valid at every gate (no FK). */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import { toServerPayload } from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EXPENSE_ID = '44444444-4444-4444-8444-444444444444'

const baseRow = {
	type: 'debt' as const,
	name: 'Car loan',
	currentBalance: 1_200_000,
	monthlyContribution: 0,
	frequency: 'monthly' as const,
	userId: USER_ID,
}

// The op's `type` (create/update/delete) is not the row's `type`, which lives inside `data`.
const op = (data: Record<string, unknown>) => ({
	id: '22222222-2222-4222-8222-222222222222',
	type: 'update' as const,
	entityType: 'balanceTracking' as const,
	entityId: '33333333-3333-4333-8333-333333333333',
	data,
	timestamp: 1_700_000_000_000,
	deviceId: 'device-1',
	userId: USER_ID,
})

describe('Gate 1: the client sync-queue schema (the SILENT one)', () => {
	it('keeps a linked expense id rather than stripping it', () => {
		const parsed = syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: EXPENSE_ID })
		expect(parsed.paymentExpenseId).toBe(EXPENSE_ID)
	})

	it('⚠️ keeps an explicit null (the UNLINK) rather than rejecting it', () => {
		const parsed = syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: null })
		expect(parsed).toHaveProperty('paymentExpenseId')
		expect(parsed.paymentExpenseId).toBeNull()
	})

	it('leaves the key absent when a partial payload omits it', () => {
		expect(syncOperationDataSchema.parse(baseRow).paymentExpenseId).toBeUndefined()
	})

	it('REJECTS a non-uuid string, while the same fixture with a uuid is accepted', () => {
		expect(() =>
			syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: 'not-a-uuid' })
		).toThrow()
		expect(() =>
			syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: EXPENSE_ID })
		).not.toThrow()
	})
})

describe('Gate 2: the server ingest schema', () => {
	// Can't fail on the schema line: superRefine discards its parse result. The rejects case exercises it.
	it('leaves a linked id on the wire (superRefine passthrough, not the schema line)', () => {
		const parsed = syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: EXPENSE_ID }))
		expect((parsed.data as Record<string, unknown>)['paymentExpenseId']).toBe(EXPENSE_ID)
	})

	it('passes an explicit null through (the unlink)', () => {
		const parsed = syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: null }))
		expect(parsed.data as Record<string, unknown>).toHaveProperty('paymentExpenseId', null)
	})

	it('accepts a payload without the key (an older client)', () => {
		expect(() => syncOperationSchema.parse(op(baseRow))).not.toThrow()
	})

	it('REJECTS a non-uuid string, while the same fixture with a uuid is accepted', () => {
		expect(() =>
			syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: 'not-a-uuid' }))
		).toThrow()
		expect(() =>
			syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: EXPENSE_ID }))
		).not.toThrow()
	})
})

describe('Gate 3: the syncBridge payload', () => {
	const entity = (paymentExpenseId: unknown) => ({
		id: '33333333-3333-4333-8333-333333333333',
		updatedAt: '2026-10-06T00:00:00.000Z',
		...baseRow,
		userId: 0,
		paymentExpenseId,
	})

	it('forwards a linked id', () => {
		expect(toServerPayload('balanceTracking', entity(EXPENSE_ID), USER_ID)).toHaveProperty(
			'paymentExpenseId',
			EXPENSE_ID
		)
	})

	it('⚠️⚠️ emits an explicit null for an unlinked row: absent, undefined or null', () => {
		// Without the key, a partial .set() keeps the old link on other devices.
		for (const value of [undefined, null]) {
			const payload = toServerPayload('balanceTracking', entity(value), USER_ID)
			expect(payload).toHaveProperty('paymentExpenseId', null)
		}
		const { paymentExpenseId: _drop, ...noKey } = entity(null)
		expect(toServerPayload('balanceTracking', noKey, USER_ID)).toHaveProperty(
			'paymentExpenseId',
			null
		)
	})

	it('⚠️ sends null for a corrupt stored value, so gate 1 never refuses the whole edit', () => {
		// Forwarded unchanged, a bad value fails the uuid gate and drops the whole op.
		for (const bad of ['not-a-uuid', 42, true, {}, '']) {
			const payload = toServerPayload('balanceTracking', entity(bad), USER_ID)
			expect(payload).toHaveProperty('paymentExpenseId', null)
			expect(() => syncOperationDataSchema.parse(payload)).not.toThrow()
		}
	})

	it('the forwarded payload passes gate 1 with the link intact', () => {
		const payload = toServerPayload('balanceTracking', entity(EXPENSE_ID), USER_ID)
		expect(syncOperationDataSchema.parse(payload).paymentExpenseId).toBe(EXPENSE_ID)
	})
})
