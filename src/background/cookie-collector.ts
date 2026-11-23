import type { TabSession } from '@/shared/types';
import { matchMarketingCookie } from '@/shared/constants';
import { recordCookie } from '@/core/session-store';

export async function snapshotTabCookies(
  session: TabSession,
  url: string,
): Promise<boolean> {
  if (!url || !/^https?:\/\//i.test(url)) return false;

  try {
    const cookies = await chrome.cookies.getAll({ url });
    let added = false;
    const now = Date.now();

    for (const cookie of cookies) {
      if (!matchMarketingCookie(cookie.name)) continue;
      recordCookie(session, {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expirationDate: cookie.expirationDate,
        timestamp: now,
        isSnapshot: true,
      });
      added = true;
    }
    return added;
  } catch {
    // Missing host permission for this origin
    return false;
  }
}

export function cookieMatchesUrl(cookieDomain: string, url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const cleanDomain = cookieDomain.replace(/^\./, '').toLowerCase();
    return host === cleanDomain || host.endsWith(`.${cleanDomain}`);
  } catch {
    return false;
  }
}
