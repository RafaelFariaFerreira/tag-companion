import { describe, expect, it } from 'vitest';
import {
  isSitePaused,
  originsForSite,
  pausedSitePatterns,
  siteKey,
} from '@/shared/paused-sites';

describe('Per-site pause', () => {
  it('keys a site by hostname without www', () => {
    expect(siteKey('https://www.loja.exemplo.com.br/checkout?x=1')).toBe('loja.exemplo.com.br');
    expect(siteKey('not a url')).toBe('');
  });

  it('pauses the host and its subdomains, never a sibling or a lookalike', () => {
    const paused = ['loja.exemplo.com.br'];
    expect(isSitePaused('https://loja.exemplo.com.br/', paused)).toBe(true);
    expect(isSitePaused('https://www.loja.exemplo.com.br/', paused)).toBe(true);
    expect(isSitePaused('https://checkout.loja.exemplo.com.br/', paused)).toBe(true);
    expect(isSitePaused('https://outra.exemplo.com.br/', paused)).toBe(false);
    expect(isSitePaused('https://falsaloja.exemplo.com.br/', paused)).toBe(false);
    expect(isSitePaused(undefined, paused)).toBe(false);
  });

  it('builds exclude patterns for content scripts', () => {
    expect(pausedSitePatterns(['loja.com'])).toEqual(['*://loja.com/*', '*://*.loja.com/*']);
  });

  it('requests the site and its subdomains only, never the public suffix', () => {
    const origins = originsForSite('https://loja.exemplo.com.br');
    expect(origins).toContain('https://loja.exemplo.com.br/*');
    expect(origins).toContain('*://*.loja.exemplo.com.br/*');
    expect(origins.some((o) => o.includes('*.com.br/*') && !o.includes('exemplo'))).toBe(false);
    expect(originsForSite('https://www.loja.com')).toEqual([
      'https://www.loja.com/*',
      '*://loja.com/*',
      '*://*.loja.com/*',
    ]);
    expect(originsForSite('http://localhost:3000')).toEqual(['http://localhost:3000/*']);
  });
});
