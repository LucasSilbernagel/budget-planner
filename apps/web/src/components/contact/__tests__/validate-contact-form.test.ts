/**
 * Pure validation tests for the contact form (story 9-1, AC-2 / AC-5).
 *
 * Boundary conditions for the required message and the optional-but-validated
 * email, with no DOM or network in play.
 */

import { describe, expect, it } from 'vitest'
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  validateContactForm,
} from '../validate-contact-form'

const validMessage = 'This is a genuinely useful piece of feedback.'

describe('validateContactForm', () => {
  it('accepts a valid message with no name or email', () => {
    expect(validateContactForm({ name: '', email: '', message: validMessage })).toEqual([])
  })

  it('flags an empty (or whitespace-only) message', () => {
    expect(validateContactForm({ name: '', email: '', message: '   ' })).toEqual([
      { field: 'message', message: 'Please enter a message.' },
    ])
  })

  it('flags a message shorter than the minimum length', () => {
    const short = 'a'.repeat(MESSAGE_MIN_LENGTH - 1)
    const errors = validateContactForm({ name: '', email: '', message: short })
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('message')
    expect(errors[0].message).toContain(`${MESSAGE_MIN_LENGTH}`)
  })

  it('accepts a message exactly at the minimum length', () => {
    const exact = 'a'.repeat(MESSAGE_MIN_LENGTH)
    expect(validateContactForm({ name: '', email: '', message: exact })).toEqual([])
  })

  it('flags a message longer than the maximum length', () => {
    const long = 'a'.repeat(MESSAGE_MAX_LENGTH + 1)
    const errors = validateContactForm({ name: '', email: '', message: long })
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('message')
    expect(errors[0].message).toContain(`${MESSAGE_MAX_LENGTH}`)
  })

  it('accepts a message exactly at the maximum length', () => {
    const exact = 'a'.repeat(MESSAGE_MAX_LENGTH)
    expect(validateContactForm({ name: '', email: '', message: exact })).toEqual([])
  })

  it('does not require an email (optional)', () => {
    expect(validateContactForm({ name: 'Jo', email: '', message: validMessage })).toEqual([])
  })

  it('flags a malformed email when one is entered', () => {
    const errors = validateContactForm({ name: '', email: 'not-an-email', message: validMessage })
    expect(errors).toEqual([{ field: 'email', message: 'Please enter a valid email address.' }])
  })

  it('accepts a well-formed email', () => {
    expect(
      validateContactForm({ name: '', email: 'user@example.com', message: validMessage })
    ).toEqual([])
  })

  it('reports both message and email errors together', () => {
    const errors = validateContactForm({ name: '', email: 'bad', message: '' })
    expect(errors.map((error) => error.field).sort()).toEqual(['email', 'message'])
  })
})
