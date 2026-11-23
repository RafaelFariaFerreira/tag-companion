import { describe, expect, it } from 'vitest';
import {
  buildConsentFromHit,
  decodeGcd,
  decodeGcs,
  mergeConsent,
  parseIcsEntries,
} from '@/core/consent';
import { createInitialConsent } from '@/shared/constants';

describe('Consent Mode v2 Decoder & State Merger', () => {
  it('decodes gcs strings accurately', () => {
    expect(decodeGcs('G100')).toEqual({
      ad_storage: 'denied',
      analytics_storage: 'denied',
    });
    expect(decodeGcs('G101')).toEqual({
      ad_storage: 'denied',
      analytics_storage: 'granted',
    });
    expect(decodeGcs('G110')).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'denied',
    });
    expect(decodeGcs('G111')).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'granted',
    });
    expect(decodeGcs('invalid')).toBeNull();
  });

  it('decodes gcd strings for all 4 Consent Mode v2 signals', () => {
    expect(decodeGcd('11p1p1p1p5')).toEqual({
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });

    expect(decodeGcd('13r3r3r3r5')).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });

    expect(decodeGcd('13p3r3p3p5')).toEqual({
      ad_storage: 'denied',
      analytics_storage: 'granted',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('treats gcs/gcd as primary truth and prevents complementary ics from overwriting it', () => {
    const initial = createInitialConsent(1000);
    const { merged } = buildConsentFromHit(initial, 'G100', '11p1p1p1p5', 2000);
    expect(merged.next.ad_storage).toBe('denied');
    expect(merged.next.analytics_storage).toBe('denied');
    expect(merged.changedKeys).toHaveLength(4);

    // Complementary ics snapshot claims granted — should NOT overwrite gcs/gcd
    const icsPatch = parseIcsEntries({
      ad_storage: { default: true },
      analytics_storage: { default: true },
    });
    const afterIcs = mergeConsent(merged.next, icsPatch, {
      source: 'ics',
      timestamp: 2500,
    });
    expect(afterIcs.next.ad_storage).toBe('denied');
    expect(afterIcs.changedKeys).toHaveLength(0);
  });
});
