import { describe, expect, it } from 'vitest';
import { PAUSED_KEY, originsForSite, readPaused } from '@/shared/paused-sites';

describe('Global pause', () => {
  it('is off unless the flag is exactly true', () => {
    expect(readPaused(undefined)).toBe(false);
    expect(readPaused({})).toBe(false);
    expect(readPaused({ [PAUSED_KEY]: 'yes' })).toBe(false);
    expect(readPaused({ [PAUSED_KEY]: true })).toBe(true);
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
