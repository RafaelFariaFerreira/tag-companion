// Dev-only: seeds a realistic session (synthetic demo data) through the real pipeline.
import {
  createTabSession,
  recordCookie,
  recordNetworkError,
  recordNetworkRequest,
  recordPageObserverEvent,
} from '@/core/session-store';
import type { TabSession } from '@/shared/types';

export function seedSession(): TabSession {
  const page = 'https://loja.exemplo.com.br/checkout/obrigado?gclid=Cj0KCQiA_demo';
  const t0 = Date.now() - 9000;
  const s = createTabSession(7, page, true, t0);
  const obs = (type: any, dt: number, payload: Record<string, unknown>) =>
    recordPageObserverEvent(s, { source: 'tag-companion-main', type, timestamp: t0 + dt, pageUrl: page, payload });
  let n = 0;
  const req = (url: string, dt: number, extra: Partial<Parameters<typeof recordNetworkRequest>[1]> = {}) =>
    recordNetworkRequest(s, {
      requestId: `r${n++}`, tabId: 7, url, method: 'GET', resourceType: 'script',
      timestamp: t0 + dt, statusCode: 200, source: 'webRequest', pageUrl: page, ...extra,
    });

  obs('consent_command', 10, { commandType: 'default', consent: { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } });
  req('https://www.googletagmanager.com/gtm.js?id=GTM-K8Q2ZP', 120);
  req('https://www.googletagmanager.com/gtag/js?id=G-7QX2K1L9PM', 410);
  req('https://connect.facebook.net/en_US/fbevents.js', 550);
  req('https://snap.licdn.com/li.lms-analytics/insight.min.js', 1120);
  req('https://www.clarity.ms/tag/k2p9xq', 1300);
  obs('datalayer_push', 600, { event: 'page_view', page_location: page });
  req('https://www.facebook.com/tr?id=482019336615&ev=PageView', 980, { resourceType: 'image' });
  recordNetworkError(s, 'r5', 'net::ERR_BLOCKED_BY_CLIENT', t0 + 990);
  recordCookie(s, { name: '_fbp', value: 'fb.1.1700000000.912', domain: '.exemplo.com.br', path: '/', timestamp: t0 + 1000 });
  obs('consent_command', 2400, { commandType: 'update', consent: { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' } });
  req('https://region1.google-analytics.com/g/collect?v=2&tid=G-7QX2K1L9PM&en=page_view&gcs=G111&dl=' + encodeURIComponent(page), 2500, { resourceType: 'ping', statusCode: 204 });
  recordCookie(s, { name: '_ga', value: 'GA1.1.123456.1700000000', domain: '.exemplo.com.br', path: '/', timestamp: t0 + 2550 });
  recordCookie(s, { name: '_ga_7QX2K1L9PM', value: 'GS1.1.1700000000.1.1', domain: '.exemplo.com.br', path: '/', timestamp: t0 + 2560 });
  obs('datalayer_push', 5700, { event: 'add_to_cart', ecommerce: { value: 349.9, currency: 'BRL' } });
  req('https://region1.google-analytics.com/g/collect?v=2&tid=G-7QX2K1L9PM&en=add_to_cart&gcs=G111&epn.value=349.90&cu=BRL', 5770, { resourceType: 'ping', statusCode: 204 });
  obs('datalayer_push', 8000, { event: 'purchase', event_id: 'T-88213', ecommerce: { transaction_id: 'T-88213', value: 349.9, currency: 'BRL' } });
  req('https://region1.google-analytics.com/g/collect?v=2&tid=G-7QX2K1L9PM&en=purchase&gcs=G111&ep.transaction_id=T-88213&epn.value=349.90&cu=BRL&_eid=T-88213', 8020, { resourceType: 'ping', statusCode: 204 });
  req('https://www.googleadservices.com/pagead/conversion/10982231/?label=abC1&value=349.90&currency_code=BRL', 8040, { resourceType: 'image' });
  req('https://www.facebook.com/tr?id=482019336615&ev=Purchase&cd[value]=349.90&cd[currency]=BRL&eid=T-88213', 8050, { resourceType: 'image' });
  req('https://www.facebook.com/tr?id=482019336615&ev=Purchase&cd[value]=349.90&cd[currency]=BRL', 8900, { resourceType: 'image' });
  return s;
}
