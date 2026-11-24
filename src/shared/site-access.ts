/**
 * Site access: the extension collects only on sites the user activated (an optional host permission).
 * Turning the switch off revokes every activated site; turning it on asks only for the site that is open.
 */

/** Storage keys of the old pause flags (v0.1.1 per-site list, v0.1.2 global flag), removed on update. */
export const LEGACY_PAUSE_KEYS = ['pausedSites', 'extensionPaused'];

/** Activated-site patterns among all granted origins: http(s) only, never the vendor hosts from the manifest. */
export function activatedSitePatterns(
  grantedOrigins: readonly string[],
  vendorHosts: readonly string[],
): string[] {
  const vendor = new Set(vendorHosts);
  return grantedOrigins.filter((o) => /^(https?|\*):\/\//i.test(o) && !vendor.has(o));
}

/** Whether a page URL is covered by one of the match patterns (scheme://host/path, path ignored). */
export function isUrlGranted(url: string | undefined, patterns: readonly string[]): boolean {
  if (!url || patterns.length === 0) return false;
  let protocol = '';
  let hostname = '';
  try {
    ({ protocol, hostname } = new URL(url));
  } catch {
    return false;
  }
  const scheme = protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return false;
  hostname = hostname.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern === '<all_urls>') return true;
    const m = /^(\*|https?):\/\/([^/]+)\//i.exec(pattern);
    if (!m) return false;
    const [, patScheme, patHost] = m;
    if (patScheme !== '*' && patScheme.toLowerCase() !== scheme) return false;
    const host = patHost.toLowerCase().replace(/:\d+$/, '');
    if (host === '*') return true;
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      return hostname === base || hostname.endsWith(`.${base}`);
    }
    return hostname === host;
  });
}

/**
 * Origins to request when the user activates a site: the host and its subdomains, never a public suffix.
 *
 * The scheme is explicit (the page's own, http or https). A wildcard scheme is rejected by
 * chrome.permissions.request, because the manifest only declares the http and https host patterns.
 */
export function originsForSite(origin: string): string[] {
  const origins = [`${origin}/*`];
  try {
    const { protocol, hostname } = new URL(origin);
    const isIp = /^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(':');
    if (!isIp && hostname !== 'localhost' && hostname.includes('.')) {
      const bare = hostname.replace(/^www\./i, '');
      origins.push(`${protocol}//${bare}/*`, `${protocol}//*.${bare}/*`);
    }
  } catch {
    // Keep the exact origin only
  }
  return [...new Set(origins)];
}
