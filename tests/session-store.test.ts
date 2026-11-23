import { describe, expect, it } from 'vitest';
import {
  buildVendorGroups,
  createTabSession,
  recordNavigation,
  recordNetworkError,
  recordNetworkRequest,
} from '@/core/session-store';

describe('Session Store, 4-State Vendor Grouping & Preserve Log', () => {
  it('separates loaded, fired, failed, and loaded_no_fire states accurately', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    // GA4 script + 2 fired hits
    recordNetworkRequest(session, {
      requestId: 's_ga4',
      tabId: 1,
      url: 'https://www.googletagmanager.com/gtag/js?id=G-XXXX',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0,
      statusCode: 200,
      source: 'webRequest',
    });
    recordNetworkRequest(session, {
      requestId: 'h_ga4_1',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-XXXX&en=page_view',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0 + 100,
      statusCode: 204,
      source: 'webRequest',
    });

    // Meta Pixel script + 1 fired + 1 aborted hit
    recordNetworkRequest(session, {
      requestId: 's_meta',
      tabId: 1,
      url: 'https://connect.facebook.net/en_US/fbevents.js',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0 + 50,
      statusCode: 200,
      source: 'webRequest',
    });
    recordNetworkRequest(session, {
      requestId: 'h_meta_pv',
      tabId: 1,
      url: 'https://www.facebook.com/tr?id=555&ev=PageView',
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 150,
      statusCode: 200,
      source: 'webRequest',
    });
    recordNetworkRequest(session, {
      requestId: 'h_meta_lead',
      tabId: 1,
      url: 'https://www.facebook.com/tr?id=555&ev=Lead',
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 200,
      source: 'webRequest',
    });
    recordNetworkError(session, 'h_meta_lead', 'net::ERR_ABORTED', t0 + 210);

    // LinkedIn script with NO hits -> loaded_no_fire
    recordNetworkRequest(session, {
      requestId: 's_li',
      tabId: 1,
      url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0 + 80,
      statusCode: 200,
      source: 'webRequest',
    });

    const groups = buildVendorGroups(session);
    const ga4 = groups.find((g) => g.vendorId === 'ga4');
    const meta = groups.find((g) => g.vendorId === 'meta_pixel');
    const linkedin = groups.find((g) => g.vendorId === 'linkedin');

    expect(ga4?.state).toBe('fired');
    expect(ga4?.accountId).toBe('G-XXXX');
    expect(ga4?.scripts).toHaveLength(1);
    expect(ga4?.hits).toHaveLength(1);

    expect(meta?.state).toBe('fired');
    expect(meta?.accountId).toBe('555');
    expect(meta?.hits.find((h) => h.eventName === 'Lead')?.status).toBe('failed');

    expect(linkedin?.state).toBe('loaded_no_fire');
    expect(linkedin?.scripts).toHaveLength(1);
    expect(linkedin?.hits).toHaveLength(0);
  });

  it('deduplicates cross-source hits reported by both webRequest and devtools.network', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);
    const url = 'https://www.facebook.com/tr?id=555&ev=Lead&eid=evt_1';

    recordNetworkRequest(session, {
      requestId: 'wr_1',
      tabId: 1,
      url,
      method: 'GET',
      resourceType: 'image',
      timestamp: t0,
      statusCode: 200,
      source: 'webRequest',
    });

    recordNetworkRequest(session, {
      requestId: 'dt_1',
      tabId: 1,
      url,
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 30,
      statusCode: 200,
      initiatorStackUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-1'],
      source: 'devtools',
    });

    expect(session.hits).toHaveLength(1);
    expect(session.hits[0].origin).toBe('gtm');
  });

  it('preserves history across navigations when preserveLog=true and clears when false', () => {
    const t0 = 100_000;
    let session = createTabSession(1, 'https://chargeblast.com/form', true, t0);

    recordNetworkRequest(session, {
      requestId: 'h1',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-1&en=generate_lead',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0 + 100,
      statusCode: 204,
      source: 'webRequest',
    });

    session = recordNavigation(session, 'https://chargeblast.com/thank-you', t0 + 500);
    expect(session.hits).toHaveLength(1);
    expect(session.navigations).toHaveLength(1);

    session.preserveLog = false;
    session = recordNavigation(session, 'https://chargeblast.com/home', t0 + 1000);
    expect(session.hits).toHaveLength(0);
    expect(session.timeline).toHaveLength(0);
  });
});
