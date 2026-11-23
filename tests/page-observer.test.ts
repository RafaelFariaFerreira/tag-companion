import { describe, expect, it } from 'vitest';
import { installPageObserver } from '@/collectors/page-observer-core';
import type { PageObserverMessage } from '@/shared/types';

function createFakeWindow() {
  const posted: PageObserverMessage[] = [];
  const listeners = new Map<string, Array<() => void>>();

  const fakeWin: Record<string, unknown> = {
    location: { href: 'https://chargeblast.com/demo?gclid=abc123' },
    postMessage(msg: PageObserverMessage) {
      posted.push(msg);
    },
    addEventListener(event: string, cb: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    setTimeout(cb: () => void) {
      cb();
      return 0;
    },
  };

  return {
    fakeWin,
    posted,
    trigger(event: string) {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
}

describe('Page Observer (MAIN world)', () => {
  it('survives GTM overwriting dataLayer.push and captures gtag consent commands', () => {
    const { fakeWin, posted } = createFakeWindow();
    installPageObserver(fakeWin);

    // Page initializes dataLayer
    const dl: unknown[] = [];
    fakeWin.dataLayer = dl;

    // Push before GTM loads
    dl.push({ event: 'page_view', page: '/demo' });

    // Simulate GTM replacing dataLayer.push with its own internal function!
    const gtmObserved: unknown[] = [];
    dl.push = function gtmPush(...args: unknown[]) {
      gtmObserved.push(...args);
      return Array.prototype.push.apply(this, args);
    };

    // Push after GTM replaced dataLayer.push — observer MUST still capture it!
    dl.push({ event: 'generate_lead', event_id: 'lead_99' });

    // Simulate gtag('consent', 'update', { ad_storage: 'granted' })
    function gtag(..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      dl.push(arguments);
    }
    gtag('consent', 'update', {
      ad_storage: 'granted',
      analytics_storage: 'granted',
    });

    const dlMessages = posted.filter((m) => m.type === 'datalayer_push');
    const consentMessages = posted.filter((m) => m.type === 'consent_command');

    expect(dlMessages).toHaveLength(2);
    expect((dlMessages[0].payload.data as { event: string }).event).toBe('page_view');
    expect((dlMessages[1].payload.data as { event: string }).event).toBe('generate_lead');
    expect(gtmObserved).toHaveLength(2);

    expect(consentMessages).toHaveLength(1);
    expect(consentMessages[0].payload.commandType).toBe('update');
    expect(consentMessages[0].payload.consent).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'granted',
    });
  });

  it('detects vendor globals and complementary google_tag_data.ics on load', () => {
    const { fakeWin, posted, trigger } = createFakeWindow();
    fakeWin.google_tag_manager = { 'GTM-TEST123': {} };
    fakeWin._linkedin_data_partner_ids = ['778899'];
    fakeWin.google_tag_data = {
      ics: {
        entries: {
          ad_storage: { default: false },
          analytics_storage: { default: true },
        },
      },
    };

    installPageObserver(fakeWin);
    trigger('load');

    const globals = posted.filter((m) => m.type === 'vendor_global');
    expect(globals.some((g) => g.payload.vendorId === 'gtm' && g.payload.accountId === 'GTM-TEST123')).toBe(true);
    expect(globals.some((g) => g.payload.vendorId === 'linkedin' && g.payload.accountId === '778899')).toBe(true);

    const ics = posted.filter((m) => m.type === 'ics_snapshot');
    expect(ics.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps dataLayer.push overhead well below the 5ms PRD budget', () => {
    const { fakeWin } = createFakeWindow();
    installPageObserver(fakeWin);
    const dl: unknown[] = [];
    fakeWin.dataLayer = dl;

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      dl.push({
        event: 'view_item',
        event_id: `evt_${i}`,
        ecommerce: { currency: 'USD', value: 99, items: [{ id: 'sku_1', name: 'Plan' }] },
      });
    }
    const elapsedPerPush = (performance.now() - start) / 100;
    expect(elapsedPerPush).toBeLessThan(5);
  });
});
