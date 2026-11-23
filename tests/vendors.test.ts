import { describe, expect, it } from 'vitest';
import {
  labelVendorParam,
  matchVendorRequest,
  parseVendorRequest,
} from '@/vendors';
import type { RawNetworkRequest } from '@/shared/types';

function makeReq(overrides: Partial<RawNetworkRequest>): RawNetworkRequest {
  return {
    requestId: 'req_1',
    tabId: 1,
    url: 'https://example.com',
    method: 'GET',
    resourceType: 'ping',
    timestamp: 1_700_000_000_000,
    statusCode: 200,
    pageUrl: 'https://chargeblast.com/demo',
    source: 'devtools',
    ...overrides,
  };
}

describe('Vendor Modules (match, parse, label)', () => {
  it('detects GTM web and custom sGTM /gtm.js containers', () => {
    const web = matchVendorRequest(
      'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234',
      'script',
    );
    expect(web?.match.vendorId).toBe('gtm');
    expect(web?.match.kind).toBe('script');
    expect(web?.match.accountId).toBe('GTM-ABC1234');
    expect(web?.match.isServerSide).toBe(false);

    const sgtm = matchVendorRequest(
      'https://sgtm.chargeblast.com/gtm.js?id=GTM-XYZ999',
      'script',
    );
    expect(sgtm?.match.vendorId).toBe('gtm');
    expect(sgtm?.match.isServerSide).toBe(true);
    expect(sgtm?.match.accountId).toBe('GTM-XYZ999');
  });

  it('decodes GA4 multi-line POST batches on custom sGTM domain', () => {
    const req = makeReq({
      url: 'https://metrics.chargeblast.com/g/collect?v=2&tid=G-CHRGBLST1&cid=123.456&gcs=G111&gcd=13r3r3r3r5',
      method: 'POST',
      requestBody: [
        'en=page_view&dl=https%3A%2F%2Fchargeblast.com%2Fpricing&ep.page_type=pricing',
        'en=generate_lead&ep.event_id=evt_lead_42&epn.value=250',
      ].join('\n'),
    });

    const parsed = parseVendorRequest(req);
    expect(parsed).not.toBeNull();
    expect(parsed?.match.isServerSide).toBe(true);
    expect(parsed?.hits).toHaveLength(2);

    const [first, second] = parsed!.hits;
    expect(first.vendorId).toBe('ga4');
    expect(first.eventName).toBe('page_view');
    expect(first.accountId).toBe('G-CHRGBLST1');
    expect(first.origin).toBe('sgtm');
    expect(first.gcs).toBe('G111');
    expect(first.hasServerSideIndicator).toBe(true);

    expect(second.eventName).toBe('generate_lead');
    expect(second.eventId).toBe('evt_lead_42');
    expect(labelVendorParam('ga4', 'ep.event_id')).toBe('Evento: event_id');
    expect(labelVendorParam('ga4', 'epn.value')).toBe('Evento (num): value');
    expect(labelVendorParam('ga4', 'tid')).toContain('Measurement ID');
  });

  it('decodes Google Ads conversions with AW- ID, label, value, currency, gclid', () => {
    const req = makeReq({
      url: 'https://www.googleadservices.com/pagead/conversion/1098765432/?label=AbCdEfGhI&value=199.5&currency_code=USD&gclid=Cj0KCQjw123&gcs=G111',
      initiatorStackUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234'],
    });

    const parsed = parseVendorRequest(req);
    expect(parsed?.hits).toHaveLength(1);
    const hit = parsed!.hits[0];
    expect(hit.vendorId).toBe('google_ads');
    expect(hit.accountId).toBe('AW-1098765432');
    expect(hit.eventName).toBe('conversion (AbCdEfGhI)');
    expect(hit.rawParams.value).toBe('199.5');
    expect(hit.rawParams.currency_code).toBe('USD');
    expect(hit.rawParams.gclid).toBe('Cj0KCQjw123');
    expect(hit.origin).toBe('gtm');
  });

  it('decodes Meta Pixel hits with id, ev, eid, cd[*] and flags ud[*] as PII', () => {
    const sha256Email = 'a'.repeat(64);
    const req = makeReq({
      url: `https://www.facebook.com/tr/?id=1122334455&ev=Lead&eid=evt_lead_42&cd[value]=500&cd[currency]=USD&ud[em]=${sha256Email}`,
    });

    const parsed = parseVendorRequest(req);
    expect(parsed?.hits).toHaveLength(1);
    const hit = parsed!.hits[0];
    expect(hit.vendorId).toBe('meta_pixel');
    expect(hit.accountId).toBe('1122334455');
    expect(hit.eventName).toBe('Lead');
    expect(hit.eventId).toBe('evt_lead_42');
    expect(labelVendorParam('meta_pixel', 'cd[value]')).toBe('Custom Data: value');

    const udParam = hit.params.find((p) => p.key === 'ud[em]');
    expect(udParam?.isPii).toBe(true);
    expect(udParam?.isHashed).toBe(true);
  });

  it('decodes LinkedIn Insight script and conversion hits', () => {
    const script = matchVendorRequest(
      'https://snap.licdn.com/li.lms-analytics/insight.min.js',
      'script',
    );
    expect(script?.match.vendorId).toBe('linkedin');
    expect(script?.match.kind).toBe('script');
    expect(script?.match.scriptName).toBe('insight.min.js');

    const req = makeReq({
      url: 'https://px.ads.linkedin.com/collect?pid=998877&conversionId=123456&fmt=gif',
    });
    const parsed = parseVendorRequest(req);
    expect(parsed?.hits[0].vendorId).toBe('linkedin');
    expect(parsed?.hits[0].accountId).toBe('998877');
    expect(parsed?.hits[0].eventName).toBe('Conversion (123456)');
  });

  it('decodes HubSpot form submissions and tracking beacons', () => {
    const formReq = makeReq({
      url: 'https://api.hsforms.com/submissions/v3/integration/submit/44556677/11111111-2222-3333-4444-555555555555',
      method: 'POST',
      requestBody: JSON.stringify({
        fields: [{ name: 'email', value: 'lead@company.com' }],
        context: {
          hutk: 'hs-cookie-token-123',
          pageUri: 'https://chargeblast.com/demo',
        },
      }),
    });
    const parsed = parseVendorRequest(formReq);
    expect(parsed?.hits[0].vendorId).toBe('hubspot');
    expect(parsed?.hits[0].accountId).toBe('44556677');
    expect(parsed?.hits[0].eventName).toBe('Form Submission');
    expect(parsed?.hits[0].rawParams.hutk).toBe('hs-cookie-token-123');
    expect(parsed?.hits[0].rawParams['field.email']).toBe('lead@company.com');
  });

  it('decodes Microsoft Clarity script and collect hits', () => {
    const script = matchVendorRequest('https://www.clarity.ms/tag/k9abc123', 'script');
    expect(script?.match.vendorId).toBe('clarity');
    expect(script?.match.accountId).toBe('k9abc123');

    const hitReq = makeReq({
      url: 'https://z.clarity.ms/collect',
      method: 'POST',
      requestBody: JSON.stringify({ e: ['0.7.1', 1, 0, 'k9abc123', 'u1', 's1'] }),
    });
    const parsed = parseVendorRequest(hitReq);
    expect(parsed?.hits[0].vendorId).toBe('clarity');
    expect(parsed?.hits[0].accountId).toBe('k9abc123');
  });

  it('decodes Phase 2 vendors (TikTok, Reddit, X, Mixpanel)', () => {
    const tt = parseVendorRequest(
      makeReq({
        url: 'https://analytics.tiktok.com/api/v2/pixel',
        method: 'POST',
        requestBody: JSON.stringify({
          event: 'SubmitForm',
          event_id: 'tt_1',
          context: { pixel: { code: 'C12345' } },
        }),
      }),
    );
    expect(tt?.hits[0].vendorId).toBe('tiktok');
    expect(tt?.hits[0].accountId).toBe('C12345');
    expect(tt?.hits[0].eventName).toBe('SubmitForm');

    const rd = parseVendorRequest(
      makeReq({
        url: 'https://alb.reddit.com/rp.gif?id=t2_abc&event=Lead&conversion_id=r1',
      }),
    );
    expect(rd?.hits[0].vendorId).toBe('reddit');
    expect(rd?.hits[0].eventName).toBe('Lead');

    const xp = parseVendorRequest(
      makeReq({
        url: 'https://analytics.twitter.com/i/adsct?txn_id=o1234&ev=Purchase',
      }),
    );
    expect(xp?.hits[0].vendorId).toBe('x_pixel');
    expect(xp?.hits[0].eventName).toBe('Purchase');

    const mpPayload = btoa(
      JSON.stringify([{ event: 'Demo Booked', properties: { token: 'mp_tok_1' } }]),
    );
    const mp = parseVendorRequest(
      makeReq({
        url: `https://api-js.mixpanel.com/track/?data=${encodeURIComponent(mpPayload)}`,
      }),
    );
    expect(mp?.hits[0].vendorId).toBe('mixpanel');
    expect(mp?.hits[0].eventName).toBe('Demo Booked');
    expect(mp?.hits[0].accountId).toBe('mp_tok_1');
  });
});
