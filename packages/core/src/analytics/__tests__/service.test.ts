import { describe, expect, it } from 'vitest'
import { filterPiiProperties } from '../service'
import { createAnalyticsService } from '../service'

describe('filterPiiProperties', () => {
  it('drops keys whose names look like PII', () => {
    const filtered = filterPiiProperties({
      page: 'home',
      email: 'a@b.com',
      userName: 'jane',
      phoneNumber: '555',
      plan: 'free',
    })
    expect(filtered).toEqual({ page: 'home', plan: 'free' })
  })

  it('drops camelCase PII key names like displayName', () => {
    expect(filterPiiProperties({ displayName: 'Jane Doe', page: 'home' })).toEqual({ page: 'home' })
  })

  it('drops string values that look like email addresses', () => {
    const filtered = filterPiiProperties({ contact: 'jane@example.com', page: 'home' })
    expect(filtered).toEqual({ page: 'home' })
  })

  it('keeps numeric and boolean values', () => {
    const filtered = filterPiiProperties({ count: 3, active: true, ratio: 0.5 })
    expect(filtered).toEqual({ count: 3, active: true, ratio: 0.5 })
  })
})

describe('createAnalyticsService', () => {
  it('records tracked events in memory', () => {
    const service = createAnalyticsService({ now: () => 1000 })
    const event = service.track('page_view', { page: 'home' })

    expect(event).toEqual({
      name: 'page_view',
      metadata: {},
      properties: { page: 'home' },
      timestamp: 1000,
    })
    expect(service.getEvents()).toHaveLength(1)
    expect(service.getEvents()[0]).toEqual(event)
  })

  it('defaults properties to an empty object', () => {
    const service = createAnalyticsService()
    expect(service.track('ping').properties).toEqual({})
  })

  it('attaches a snapshot of the ambient metadata to each event', () => {
    const service = createAnalyticsService({ metadata: { source: 'newsletter' } })
    const event = service.track('page_view')
    expect(event.metadata).toEqual({ source: 'newsletter' })

    // Updating metadata must not mutate already-recorded events.
    service.setMetadata({ source: 'twitter' })
    expect(service.getEvents()[0].metadata).toEqual({ source: 'newsletter' })
    expect(service.track('page_view').metadata).toEqual({ source: 'twitter' })
  })

  it('strips PII from event properties before recording', () => {
    const service = createAnalyticsService()
    const event = service.track('signup_click', { email: 'a@b.com', page: 'pricing' })
    expect(event.properties).toEqual({ page: 'pricing' })
  })

  it('clears recorded events', () => {
    const service = createAnalyticsService()
    service.track('a')
    service.track('b')
    expect(service.getEvents()).toHaveLength(2)
    service.clear()
    expect(service.getEvents()).toHaveLength(0)
  })

  it('returns a defensive copy of the event list', () => {
    const service = createAnalyticsService()
    service.track('a')
    const events = service.getEvents() as unknown as unknown[]
    expect(() => events.push('mutation')).not.toThrow()
    expect(service.getEvents()).toHaveLength(1)
  })
})
