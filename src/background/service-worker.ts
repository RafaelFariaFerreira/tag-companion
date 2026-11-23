import type {
  RawNetworkRequest,
  RuntimeMessage,
  TabSession,
} from '@/shared/types';
import { matchMarketingCookie } from '@/shared/constants';
import {
  clearTabSession,
  createTabSession,
  recomputeDerivedState,
  recordCookie,
  recordNavigation,
  recordNetworkCompleted,
  recordNetworkError,
  recordNetworkRequest,
  recordPageObserverEvent,
} from '@/core/session-store';
import { cookieMatchesUrl, snapshotTabCookies } from './cookie-collector';
import {
  PAUSED_SITES_KEY,
  isSitePaused,
  pausedSitePatterns,
} from '@/shared/paused-sites';

const sessions = new Map<number, TabSession>();
const tabPorts = new Map<number, Set<chrome.runtime.Port>>();
const broadcastTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Sites where the user paused collection without revoking the host permission.
let pausedSites: string[] = [];
const pausedSitesReady = chrome.storage.local
  .get(PAUSED_SITES_KEY)
  .then((stored) => {
    pausedSites = (stored?.[PAUSED_SITES_KEY] as string[] | undefined) ?? [];
  })
  .catch(() => {});

function isPaused(url: string | undefined): boolean {
  return isSitePaused(url, pausedSites);
}

const MAIN_SCRIPT_ID = 'tag-companion-page-observer';
const BRIDGE_SCRIPT_ID = 'tag-companion-content-bridge';

function getOrCreateSession(tabId: number, url = ''): TabSession {
  let session = sessions.get(tabId);
  if (!session) {
    session = createTabSession(tabId, url, true);
    sessions.set(tabId, session);
  } else if (url && !session.currentUrl) {
    session.currentUrl = url;
  }
  return session;
}

function scheduleBroadcast(tabId: number): void {
  if (broadcastTimers.has(tabId)) return;
  const timer = setTimeout(() => {
    broadcastTimers.delete(tabId);
    const session = sessions.get(tabId);
    if (!session) return;

    recomputeDerivedState(session);
    persistSession(tabId, session);

    const ports = tabPorts.get(tabId);
    if (!ports || ports.size === 0) return;

    const payload: RuntimeMessage = {
      type: 'SESSION_UPDATE',
      tabId,
      session,
    };

    for (const port of ports) {
      try {
        port.postMessage(payload);
      } catch {
        ports.delete(port);
      }
    }
  }, 80);

  broadcastTimers.set(tabId, timer);
}

function persistSession(tabId: number, session: TabSession): void {
  try {
    chrome.storage.session?.set({ [`session_${tabId}`]: session }).catch(() => {});
  } catch {
    // Ignore storage quota errors
  }
}

async function restoreSessionIfNeeded(tabId: number): Promise<TabSession> {
  const existing = sessions.get(tabId);
  if (existing) return existing;

  try {
    const key = `session_${tabId}`;
    const stored = await chrome.storage.session?.get(key);
    if (stored && stored[key]) {
      const restored = stored[key] as TabSession;
      sessions.set(tabId, restored);
      return restored;
    }
  } catch {
    // Ignore
  }

  let url = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab.url ?? '';
  } catch {
    // Tab might not be accessible
  }
  const fresh = createTabSession(tabId, url, true);
  sessions.set(tabId, fresh);
  return fresh;
}

function decodeRequestBody(
  body: chrome.webRequest.WebRequestBody | null | undefined,
): string | undefined {
  if (!body) return undefined;
  if (body.raw && body.raw.length > 0) {
    const decoder = new TextDecoder('utf-8');
    const chunks: string[] = [];
    for (const part of body.raw) {
      if (part.bytes) {
        chunks.push(decoder.decode(part.bytes));
      }
    }
    const joined = chunks.join('');
    return joined || undefined;
  }
  if (body.formData) {
    const sp = new URLSearchParams();
    for (const [k, values] of Object.entries(body.formData)) {
      for (const v of values) {
        sp.append(k, v);
      }
    }
    return sp.toString() || undefined;
  }
  return undefined;
}

async function syncRegisteredContentScripts(): Promise<void> {
  try {
    const perms = await chrome.permissions.getAll();
    const staticVendorHosts = new Set(
      chrome.runtime.getManifest().host_permissions ?? [],
    );
    const origins = (perms.origins ?? []).filter(
      (o) =>
        /^(https?|\*):\/\//i.test(o) && !staticVendorHosts.has(o),
    );

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [MAIN_SCRIPT_ID, BRIDGE_SCRIPT_ID],
    });
    const existingIds = existing.map((s) => s.id);
    if (existingIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: existingIds });
    }

    if (origins.length === 0) return;

    await pausedSitesReady;
    const excludeMatches = pausedSitePatterns(pausedSites);

    await chrome.scripting.registerContentScripts([
      {
        id: BRIDGE_SCRIPT_ID,
        matches: origins,
        js: ['collectors/content-bridge.js'],
        runAt: 'document_start',
        world: 'ISOLATED',
        allFrames: false,
        excludeMatches,
      },
      {
        id: MAIN_SCRIPT_ID,
        matches: origins,
        js: ['collectors/page-observer.js'],
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: false,
        excludeMatches,
      },
    ]);
  } catch {
    // Ignore registration errors when permissions change rapidly
  }
}

async function injectIntoTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['collectors/content-bridge.js'],
      world: 'ISOLATED',
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['collectors/page-observer.js'],
      world: 'MAIN',
    });
  } catch {
    // Restricted page (chrome://, edge://, etc.) or missing permission
  }
}

// Configure side panel to open when clicking extension toolbar action
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  syncRegisteredContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  syncRegisteredContentScripts();
});

chrome.permissions.onAdded.addListener(() => {
  syncRegisteredContentScripts();
});

chrome.permissions.onRemoved.addListener(() => {
  syncRegisteredContentScripts();
});

// Pause / resume from the UI switch: re-register scripts and, on resume,
// start observing open tabs of that site right away (no reload needed for new events).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[PAUSED_SITES_KEY]) return;
  const before = pausedSites;
  pausedSites = (changes[PAUSED_SITES_KEY].newValue as string[] | undefined) ?? [];
  const resumed = before.filter((key) => !pausedSites.includes(key));
  syncRegisteredContentScripts().then(async () => {
    if (resumed.length === 0) return;
    const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.url && isSitePaused(tab.url, resumed)) {
        injectIntoTab(tab.id);
      }
    }
  });
});

// Clean up tab session when closed (privacy requirement from PRD)
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  tabPorts.delete(tabId);
  const timer = broadcastTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    broadcastTimers.delete(tabId);
  }
  try {
    chrome.storage.session?.remove(`session_${tabId}`).catch(() => {});
  } catch {
    // Ignore
  }
});

// Track main-frame navigations
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isPaused(changeInfo.url ?? tab.url)) return;
  if (changeInfo.status === 'loading' && changeInfo.url && /^https?:\/\//i.test(changeInfo.url)) {
    const session = getOrCreateSession(tabId, changeInfo.url);
    const updated = recordNavigation(session, changeInfo.url, Date.now());
    sessions.set(tabId, updated);
    scheduleBroadcast(tabId);
  } else if (changeInfo.status === 'complete' && tab.url && /^https?:\/\//i.test(tab.url)) {
    const session = getOrCreateSession(tabId, tab.url);
    session.pageLoadedAt = Date.now();
    snapshotTabCookies(session, tab.url).then(() => {
      scheduleBroadcast(tabId);
    });
  }
});

// Collector 2: webRequest observation (works even when DevTools is closed)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const existing = sessions.get(details.tabId);
    if (isPaused(existing?.currentUrl || (details as { documentUrl?: string }).documentUrl || details.initiator)) return;
    const session = getOrCreateSession(details.tabId);
    const req: RawNetworkRequest = {
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      resourceType: details.type,
      timestamp: Math.round(details.timeStamp || Date.now()),
      requestBody: decodeRequestBody(details.requestBody),
      initiator: details.initiator,
      pageUrl: session.currentUrl,
      source: 'webRequest',
    };
    const { matched } = recordNetworkRequest(session, req);
    if (matched) {
      scheduleBroadcast(details.tabId);
    }
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['requestBody'],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const session = sessions.get(details.tabId);
    if (!session) return;
    recordNetworkCompleted(
      session,
      details.requestId,
      details.statusCode,
      Math.round(details.timeStamp || Date.now()),
    );
    scheduleBroadcast(details.tabId);
  },
  { urls: ['http://*/*', 'https://*/*'] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const session = sessions.get(details.tabId);
    if (!session) return;
    recordNetworkError(
      session,
      details.requestId,
      details.error,
      Math.round(details.timeStamp || Date.now()),
    );
    scheduleBroadcast(details.tabId);
  },
  { urls: ['http://*/*', 'https://*/*'] },
);

// Collector 3: Marketing cookies observer
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) return;
  const cookie = changeInfo.cookie;
  if (!matchMarketingCookie(cookie.name)) return;

  const now = Date.now();
  for (const [tabId, session] of sessions.entries()) {
    if (!session.currentUrl || isPaused(session.currentUrl)) continue;
    if (!cookieMatchesUrl(cookie.domain, session.currentUrl)) continue;
    recordCookie(session, {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expirationDate: cookie.expirationDate,
      timestamp: now,
    });
    scheduleBroadcast(tabId);
  }
});

// Live UI port connections (DevTools panel + Side Panel)
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('tag-companion-ui:')) return;
  const tabIdStr = port.name.split(':')[1];
  const tabId = Number(tabIdStr);
  if (!Number.isFinite(tabId) || tabId < 0) return;

  let set = tabPorts.get(tabId);
  if (!set) {
    set = new Set();
    tabPorts.set(tabId, set);
  }
  set.add(port);

  // Send immediate state snapshot
  restoreSessionIfNeeded(tabId).then(async (session) => {
    if (session.currentUrl) {
      await snapshotTabCookies(session, session.currentUrl);
    }
    recomputeDerivedState(session);
    try {
      port.postMessage({
        type: 'SESSION_UPDATE',
        tabId,
        session,
      } satisfies RuntimeMessage);
    } catch {
      // Port disconnected
    }
  });

  // Periodic refresh while UI is open so time-window diagnostics (5s event_without_hit, 3s click_id) update live
  const interval = setInterval(() => {
    const session = sessions.get(tabId);
    if (!session) return;
    const prevDiagCount = session.diagnostics.length;
    recomputeDerivedState(session);
    if (session.diagnostics.length !== prevDiagCount) {
      scheduleBroadcast(tabId);
    }
  }, 2000);

  port.onDisconnect.addListener(() => {
    clearInterval(interval);
    const ports = tabPorts.get(tabId);
    if (ports) {
      ports.delete(port);
      if (ports.size === 0) {
        tabPorts.delete(tabId);
      }
    }
  });
});

// Message router for content-bridge, devtools network-bridge, and UI actions
chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    switch (message.type) {
      case 'PAGE_OBSERVER_EVENT': {
        const tabId = sender.tab?.id;
        if (typeof tabId !== 'number' || tabId < 0) return false;
        if (isPaused(sender.tab?.url)) return false;
        const session = getOrCreateSession(tabId, sender.tab?.url ?? '');
        recordPageObserverEvent(session, message.event);
        scheduleBroadcast(tabId);
        return false;
      }

      case 'DEVTOOLS_NETWORK_REQUEST': {
        if (isPaused(sessions.get(message.tabId)?.currentUrl || message.request.pageUrl)) {
          return false;
        }
        const session = getOrCreateSession(
          message.tabId,
          message.request.pageUrl ?? '',
        );
        const { matched } = recordNetworkRequest(session, message.request);
        if (matched) {
          scheduleBroadcast(message.tabId);
        }
        return false;
      }

      case 'GET_SESSION': {
        restoreSessionIfNeeded(message.tabId).then((session) => {
          recomputeDerivedState(session);
          sendResponse({ session });
        });
        return true;
      }

      case 'CLEAR_SESSION': {
        const current = getOrCreateSession(message.tabId);
        const cleared = clearTabSession(current);
        sessions.set(message.tabId, cleared);
        scheduleBroadcast(message.tabId);
        sendResponse({ session: cleared });
        return true;
      }

      case 'SET_PRESERVE_LOG': {
        const session = getOrCreateSession(message.tabId);
        session.preserveLog = message.preserveLog;
        scheduleBroadcast(message.tabId);
        sendResponse({ ok: true });
        return true;
      }

      case 'ACTIVATE_ORIGIN': {
        (async () => {
          await syncRegisteredContentScripts();
          await injectIntoTab(message.tabId);
          const session = await restoreSessionIfNeeded(message.tabId);
          if (session.currentUrl) {
            await snapshotTabCookies(session, session.currentUrl);
          }
          scheduleBroadcast(message.tabId);
          sendResponse({ ok: true });
        })();
        return true;
      }

      case 'CHECK_ORIGIN_PERMISSION': {
        const originPattern = message.origin.endsWith('/*')
          ? message.origin
          : `${message.origin}/*`;
        chrome.permissions
          .contains({ origins: [originPattern] })
          .then((granted) => sendResponse({ granted }))
          .catch(() => sendResponse({ granted: false }));
        return true;
      }

      default:
        return false;
    }
  },
);
