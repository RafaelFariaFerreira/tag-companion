import { describe, expect, it } from 'vitest';
import { activatedSitePatterns, isUrlGranted, originsForSite } from '@/shared/site-access';

describe('Site access', () => {
  it('keeps activated sites only, never the vendor hosts', () => {
    const vendor = ['*://*.google-analytics.com/*'];
    expect(
      activatedSitePatterns(['*://*.google-analytics.com/*', 'https://uol.com/*', 'chrome://x/*'], vendor),
    ).toEqual(['https://uol.com/*']);
  });

  it('drops vendor hosts even when Chrome normalizes their paths', () => {
    const manifest = ['*://*.google.com/pagead/*', '*://*.facebook.com/tr*', '*://t.co/i/adsct*'];
    // What chrome.permissions.getAll() actually returns for those, plus one activated site
    const granted = ['*://*.google.com/*', '*://*.facebook.com/*', '*://t.co/*', 'https://uol.com/*'];
    expect(activatedSitePatterns(granted, manifest)).toEqual(['https://uol.com/*']);
  });

  it('covers only the activated site and its subdomains', () => {
    const granted = originsForSite('https://www.uol.com');
    expect(isUrlGranted('https://www.uol.com/noticias', granted)).toBe(true);
    expect(isUrlGranted('https://esporte.uol.com/', granted)).toBe(true);
    expect(isUrlGranted('https://globo.com/', granted)).toBe(false);
    expect(isUrlGranted('https://falsauol.com/', granted)).toBe(false);
    expect(isUrlGranted('http://uol.com/', granted)).toBe(false);
    expect(isUrlGranted('https://uol.com', granted)).toBe(true);
    expect(isUrlGranted(undefined, granted)).toBe(false);
    expect(isUrlGranted('https://globo.com/', [])).toBe(false);
  });

  it('after revoking everything, activating one site does not bring the others back', () => {
    const afterRevoke: string[] = [];
    expect(isUrlGranted('https://globo.com/', afterRevoke)).toBe(false);
    const afterUol = [...afterRevoke, ...originsForSite('https://uol.com')];
    expect(isUrlGranted('https://uol.com/', afterUol)).toBe(true);
    expect(isUrlGranted('https://globo.com/', afterUol)).toBe(false);
  });

  it('requests the site and its subdomains only, never the public suffix', () => {
    const origins = originsForSite('https://loja.exemplo.com.br');
    expect(origins).toEqual(['https://loja.exemplo.com.br/*', 'https://*.loja.exemplo.com.br/*']);
    expect(originsForSite('https://www.loja.com')).toEqual([
      'https://www.loja.com/*',
      'https://loja.com/*',
      'https://*.loja.com/*',
    ]);
    expect(originsForSite('http://app.loja.com')).toContain('http://*.app.loja.com/*');
    expect(originsForSite('http://localhost:3000')).toEqual(['http://localhost:3000/*']);
  });

  it('never uses a wildcard scheme, which chrome.permissions.request rejects', () => {
    for (const site of ['https://a.com', 'http://www.b.com.br', 'https://x.y.z.io']) {
      for (const o of originsForSite(site)) expect(o.startsWith('*://')).toBe(false);
    }
  });
});
