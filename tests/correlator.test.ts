import { describe, expect, it } from 'vitest';
import { correlateSession } from '@/core/correlator';
import type { DataLayerEvent, ParsedHit } from '@/shared/types';

function makeDlEvent(overrides: Partial<DataLayerEvent>): DataLayerEvent {
  return {
    id: 'dl_1',
    timestamp: 10_000,
    pageUrl: 'https://example.com',
    eventName: 'generate_lead',
    payload: { event: 'generate_lead' },
    correlatedHitIds: [],
    ...overrides,
  };
}

function makeHit(overrides: Partial<ParsedHit>): ParsedHit {
  return {
    id: 'hit_1',
    requestId: 'r_1',
    vendorId: 'ga4',
    vendorName: 'GA4',
    category: 'analytics',
    eventName: 'generate_lead',
    endpoint: '/g/collect',
    url: 'https://www.google-analytics.com/g/collect?en=generate_lead',
    method: 'POST',
    status: 'fired',
    statusCode: 204,
    timestamp: 10_400,
    pageUrl: 'https://example.com',
    origin: 'gtm',
    params: [],
    rawParams: {},
    source: 'devtools',
    ...overrides,
  };
}

describe('Event -> Hit Correlator', () => {
  it('prioritizes exact event_id match over time window', () => {
    const events = [
      makeDlEvent({ id: 'dl_1', timestamp: 10_000, eventId: 'evt_abc' }),
      makeDlEvent({ id: 'dl_2', timestamp: 12_000, eventName: 'other_event' }),
    ];
    const hits = [
      makeHit({
        id: 'hit_meta',
        vendorId: 'meta_pixel',
        vendorName: 'Meta Pixel',
        eventName: 'Lead',
        eventId: 'evt_abc',
        timestamp: 14_500, // beyond 3s from dl_1, still matched via event_id!
      }),
    ];

    correlateSession(events, hits);
    expect(hits[0].correlatedEventId).toBe('dl_1');
    expect(hits[0].correlationReason).toBe('event_id');
    expect(events[0].correlatedHitIds).toEqual(['hit_meta']);
  });

  it('correlates semantically related events within the 3-second window', () => {
    const events = [
      makeDlEvent({ id: 'dl_lead', timestamp: 20_000, eventName: 'generate_lead' }),
    ];
    const hits = [
      makeHit({
        id: 'hit_meta_lead',
        vendorId: 'meta_pixel',
        vendorName: 'Meta Pixel',
        eventName: 'Lead',
        timestamp: 21_200,
      }),
      makeHit({
        id: 'hit_late',
        vendorId: 'ga4',
        eventName: 'generate_lead',
        timestamp: 24_000, // > 3000ms after dl_lead
      }),
    ];

    correlateSession(events, hits);
    expect(hits[0].correlatedEventId).toBe('dl_lead');
    expect(hits[0].correlationReason).toBe('time_window');
    expect(hits[1].correlatedEventId).toBeUndefined();
    expect(events[0].correlatedHitIds).toEqual(['hit_meta_lead']);
  });
});
