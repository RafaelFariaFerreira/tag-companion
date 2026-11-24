/**
 * Global pause: the switch turns the whole extension off, on every site.
 * Stored in chrome.storage.local as a boolean so the service worker and every panel see the same state.
 * Host permissions are kept; resuming picks up where it left off.
 */
export const PAUSED_KEY = 'extensionPaused';

/** Key of the old per-site pause list (v0.1.1), removed on install/update. */
export const LEGACY_PAUSED_SITES_KEY = 'pausedSites';

export function readPaused(stored: Record<string, unknown> | undefined): boolean {
  return stored?.[PAUSED_KEY] === true;
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
