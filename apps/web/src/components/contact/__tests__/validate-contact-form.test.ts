// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
	MESSAGE_MAX_LENGTH,
	MESSAGE_MIN_LENGTH,
	validateContactForm,
} from '../validate-contact-form'

const validMessage = 'This is a genuinely useful piece of feedback.'

describe('validateContactForm', () => {
	it.each([
		['a valid message with no name or email', { name: '', email: '', message: validMessage }],
		[
			'a message exactly at the minimum length',
			{
				name: '',
				email: '',
				message: 'a'.repeat(MESSAGE_MIN_LENGTH),
			},
		],
		[
			'a message exactly at the maximum length',
			{
				name: '',
				email: '',
				message: 'a'.repeat(MESSAGE_MAX_LENGTH),
			},
		],
		['a missing email (it is optional)', { name: 'Jo', email: '', message: validMessage }],
		['a well-formed email', { name: '', email: 'user@example.com', message: validMessage }],
	])('accepts %s', (_title, { name, email, message }) => {
		expect(validateContactForm({ name, email, message })).toEqual([])
	})

	it('flags an empty (or whitespace-only) message', () => {
		expect(validateContactForm({ name: '', email: '', message: '   ' })).toEqual([
			{ field: 'message', message: 'Please enter a message.' },
		])
	})

	it.each([
		[
			'shorter than the minimum',
			{
				length: MESSAGE_MIN_LENGTH - 1,
				bound: MESSAGE_MIN_LENGTH,
			},
		],
		['longer than the maximum', { length: MESSAGE_MAX_LENGTH + 1, bound: MESSAGE_MAX_LENGTH }],
	])('flags a message %s length', (_title, { length, bound }) => {
		const errors = validateContactForm({ name: '', email: '', message: 'a'.repeat(length) })
		expect(errors).toHaveLength(1)
		expect(errors[0].field).toBe('message')
		expect(errors[0].message).toContain(`${bound}`)
	})

	it('flags a malformed email when one is entered', () => {
		const errors = validateContactForm({ name: '', email: 'not-an-email', message: validMessage })
		expect(errors).toEqual([{ field: 'email', message: 'Please enter a valid email address.' }])
	})

	it('reports both message and email errors together', () => {
		const errors = validateContactForm({ name: '', email: 'bad', message: '' })
		expect(errors.map((error) => error.field).sort()).toEqual(['email', 'message'])
	})
})
