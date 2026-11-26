import { describe, expect, it } from 'vitest';
import {
  createTabSession,
  recomputeDerivedState,
  recordCookie,
  recordNetworkError,
  recordNetworkRequest,
  recordPageObserverEvent,
} from '@/core/session-store';

describe('Automated Diagnostics Engine (All 9 Rules)', () => {
  it('1. flags tag_before_consent for Meta hit and _fbp cookie when ad_storage=denied, but NOT GA4 cookieless ping', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordPageObserverEvent(session, {
      source: 'tag-companion-main',
      type: 'consent_command',
      timestamp: t0,
      pageUrl: 'https://chargeblast.com',
      payload: {
        commandType: 'default',
        consent: { ad_storage: 'denied', analytics_storage: 'denied' },
      },
    });

    // GA4 cookieless ping (gcs=G100) is expected behavior -> should NOT trigger violation
    recordNetworkRequest(session, {
      requestId: 'r_ga4_cookieless',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-TEST1&en=page_view&gcs=G100',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0 + 100,
      statusCode: 204,
      source: 'webRequest',
    });

    // Meta Pixel hit while ad_storage=denied -> SHOULD trigger violation
    recordNetworkRequest(session, {
      requestId: 'r_meta',
      tabId: 1,
      url: 'https://www.facebook.com/tr?id=12345&ev=PageView',
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 200,
      statusCode: 200,
      source: 'webRequest',
    });

    // _fbp cookie created while ad_storage=denied -> SHOULD trigger violation
    recordCookie(session, {
      name: '_fbp',
      value: 'fb.1.1700000000.123456',
      domain: '.chargeblast.com',
      path: '/',
      timestamp: t0 + 250,
    });

    const consentAlerts = session.diagnostics.filter(
      (d) => d.ruleId === 'tag_before_consent',
    );
    expect(consentAlerts).toHaveLength(2);
    expect(consentAlerts.every((d) => d.severity === 'high')).toBe(true);
  });

  it('2. flags hit_lost on ERR_ABORTED and ERR_BLOCKED_BY_CLIENT', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordNetworkRequest(session, {
      requestId: 'r_aborted',
      tabId: 1,
      url: 'https://www.facebook.com/tr?id=12345&ev=Lead',
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 100,
      source: 'webRequest',
    });
    recordNetworkError(session, 'r_aborted', 'net::ERR_ABORTED', t0 + 120);

    const lost = session.diagnostics.filter((d) => d.ruleId === 'hit_lost');
    expect(lost).toHaveLength(1);
    expect(lost[0].severity).toBe('high');
    expect(lost[0].description).toContain('ERR_ABORTED');
  });

  it('3. flags event_without_hit after 5 seconds when conversion push has no correlated hit', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordPageObserverEvent(session, {
      source: 'tag-companion-main',
      type: 'datalayer_push',
      timestamp: t0,
      pageUrl: 'https://chargeblast.com',
      payload: { data: { event: 'generate_lead', form: 'demo' } },
    });

    // Before 5s: no alert yet
    recomputeDerivedState(session, t0 + 3000);
    expect(
      session.diagnostics.filter((d) => d.ruleId === 'event_without_hit'),
    ).toHaveLength(0);

    // After 5s: alert fires
    recomputeDerivedState(session, t0 + 5500);
    const alerts = session.diagnostics.filter(
      (d) => d.ruleId === 'event_without_hit',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
  });

  it('4. flags duplicate_hit when same event fires twice within 2 seconds', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordNetworkRequest(session, {
      requestId: 'r1',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-111&en=generate_lead&gcs=G111',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0,
      statusCode: 204,
      initiatorStackUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-1'],
      source: 'devtools',
    });

    recordNetworkRequest(session, {
      requestId: 'r2',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-111&en=generate_lead&gcs=G111',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0 + 400,
      statusCode: 204,
      initiatorStackUrls: ['https://chargeblast.com/app.js'],
      source: 'devtools',
    });

    const dupes = session.diagnostics.filter((d) => d.ruleId === 'duplicate_hit');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].severity).toBe('medium');
    expect(dupes[0].description).toContain('origens diferentes');
  });

  it('5. flags missing_dedup_key when sGTM is active and Meta Lead lacks eid', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    // sGTM GA4 hit sets hasServerSideGtm = true
    recordNetworkRequest(session, {
      requestId: 'r_sgtm',
      tabId: 1,
      url: 'https://sgtm.chargeblast.com/g/collect?v=2&tid=G-111&en=page_view&gcs=G111',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0,
      statusCode: 200,
      source: 'devtools',
    });

    // Meta Lead without eid
    recordNetworkRequest(session, {
      requestId: 'r_meta_lead',
      tabId: 1,
      url: 'https://www.facebook.com/tr?id=999&ev=Lead',
      method: 'GET',
      resourceType: 'image',
      timestamp: t0 + 200,
      statusCode: 200,
      source: 'devtools',
    });

    const dedupAlerts = session.diagnostics.filter(
      (d) => d.ruleId === 'missing_dedup_key',
    );
    expect(dedupAlerts).toHaveLength(1);
    expect(dedupAlerts[0].vendorId).toBe('meta_pixel');
  });

  it('6. flags wrong_property when multiple GA4 Measurement IDs or GTM containers exist', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordNetworkRequest(session, {
      requestId: 'gtm1',
      tabId: 1,
      url: 'https://www.googletagmanager.com/gtm.js?id=GTM-AAA111',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0,
      statusCode: 200,
      source: 'webRequest',
    });
    recordNetworkRequest(session, {
      requestId: 'gtm2',
      tabId: 1,
      url: 'https://www.googletagmanager.com/gtm.js?id=GTM-BBB222',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0 + 50,
      statusCode: 200,
      source: 'webRequest',
    });

    const alerts = session.diagnostics.filter((d) => d.ruleId === 'wrong_property');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].description).toContain('GTM-AAA111');
    expect(alerts[0].description).toContain('GTM-BBB222');
  });

  it('7. flags pii_in_url when plain email is present in dl param', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordNetworkRequest(session, {
      requestId: 'r_pii',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-111&en=page_view&dl=https%3A%2F%2Fchargeblast.com%2Fthanks%3Femail%3Drafael%40chargeblast.com',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0,
      statusCode: 204,
      source: 'devtools',
    });

    const alerts = session.diagnostics.filter((d) => d.ruleId === 'pii_in_url');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    // Description itself must mask the email!
    expect(alerts[0].description).not.toContain('rafael@chargeblast.com');
    expect(alerts[0].description).toContain('ra***@chargeblast.com');
  });

  it('8. flags click_id_not_stored when gclid is in URL but _gcl_aw cookie is missing', () => {
    const t0 = 100_000;
    const session = createTabSession(
      1,
      'https://chargeblast.com/?gclid=Cj0KCQjwTEST',
      true,
      t0,
    );

    recomputeDerivedState(session, t0 + 4000);
    const alerts = session.diagnostics.filter(
      (d) => d.ruleId === 'click_id_not_stored',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('low');

    // Once _gcl_aw cookie appears, diagnostic clears
    recordCookie(session, {
      name: '_gcl_aw',
      value: 'GCL.1700000000.Cj0KCQjwTEST',
      domain: '.chargeblast.com',
      path: '/',
      timestamp: t0 + 4200,
    });
    recomputeDerivedState(session, t0 + 4500);
    expect(
      session.diagnostics.filter((d) => d.ruleId === 'click_id_not_stored'),
    ).toHaveLength(0);
  });

  it('8b. flags click_id_not_stored for an OpenAI Ads oppref without the __oppref cookie', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://loja.com/?oppref=opp_abc123', true, t0);

    recomputeDerivedState(session, t0 + 4000);
    const alerts = session.diagnostics.filter((d) => d.ruleId === 'click_id_not_stored');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vendorId).toBe('openai_ads');

    recordCookie(session, {
      name: '__oppref',
      value: 'opp_abc123',
      domain: '.loja.com',
      path: '/',
      timestamp: t0 + 4200,
    });
    recomputeDerivedState(session, t0 + 4500);
    expect(session.diagnostics.filter((d) => d.ruleId === 'click_id_not_stored')).toHaveLength(0);
  });

  it('9. flags loaded_no_fire with consent context when script loads without hits', () => {
    const t0 = 100_000;
    const session = createTabSession(1, 'https://chargeblast.com', true, t0);

    recordNetworkRequest(session, {
      requestId: 'r_li_script',
      tabId: 1,
      url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
      method: 'GET',
      resourceType: 'script',
      timestamp: t0,
      statusCode: 200,
      source: 'webRequest',
    });

    const alerts = session.diagnostics.filter((d) => d.ruleId === 'loaded_no_fire');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].vendorId).toBe('linkedin');
    expect(alerts[0].description).toContain('ad_storage=');
  });
});
