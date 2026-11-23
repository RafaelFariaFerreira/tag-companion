/**
 * Per-site pause: the user keeps the host permission but stops collection.
 * Stored in chrome.storage.local as a list of site keys (hostname without "www.").
 * A key covers the host itself and its subdomains.
 */
export const PAUSED_SITES_KEY = 'pausedSites';

export function siteKey(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isSitePaused(url: string | undefined, pausedSites: readonly string[]): boolean {
  if (!url || pausedSites.length === 0) return false;
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return pausedSites.some((key) => hostname === key || hostname.endsWith(`.${key}`));
}

/** Match patterns that cover a paused site, for excludeMatches. */
export function pausedSitePatterns(pausedSites: readonly string[]): string[] {
  return pausedSites.flatMap((key) => [`*://${key}/*`, `*://*.${key}/*`]);
}

/** Origins to request when the user activates a site: the host and its subdomains, never a public suffix. */
export function originsForSite(origin: string): string[] {
  const origins = [`${origin}/*`];
  try {
    const { hostname } = new URL(origin);
    const isIp = /^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(':');
    if (!isIp && hostname !== 'localhost' && hostname.includes('.')) {
      const bare = hostname.replace(/^www\./i, '');
      origins.push(`*://${bare}/*`, `*://*.${bare}/*`);
    }
  } catch {
    // Keep the exact origin only
  }
  return [...new Set(origins)];
}
