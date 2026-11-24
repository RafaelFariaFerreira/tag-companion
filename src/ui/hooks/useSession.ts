import { useCallback, useEffect, useState } from 'react';
import type { RuntimeMessage, TabSession } from '@/shared/types';
import { createTabSession, extractOrigin } from '@/core/session-store';
import { PAUSED_SITES_KEY, isSitePaused, originsForSite, siteKey } from '@/shared/paused-sites';

export interface UseSessionResult {
  tabId: number | null;
  session: TabSession | null;
  originGranted: boolean;
  /** Collection paused on this site by the user (the permission is kept). */
  sitePaused: boolean;
  isRestrictedPage: boolean;
  /** The header switch: on = granted and not paused. Turning it on asks for permission when needed. */
  setMonitoring: (on: boolean) => Promise<void>;
  requestOriginPermission: () => Promise<boolean>;
  clearSession: () => Promise<void>;
  setPreserveLog: (value: boolean) => Promise<void>;
}

export function useSession(mode: 'devtools' | 'sidepanel'): UseSessionResult {
  const [tabId, setTabId] = useState<number | null>(() => {
    if (mode === 'devtools' && typeof chrome !== 'undefined' && chrome.devtools?.inspectedWindow) {
      return chrome.devtools.inspectedWindow.tabId;
    }
    return null;
  });
  const [tabUrl, setTabUrl] = useState<string>('');
  const [session, setSession] = useState<TabSession | null>(null);
  const [originGranted, setOriginGranted] = useState<boolean>(false);
  const [pausedSites, setPausedSites] = useState<string[]>([]);

  // Paused sites live in chrome.storage.local so the service worker sees the same list.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local
      .get(PAUSED_SITES_KEY)
      .then((stored) => setPausedSites((stored?.[PAUSED_SITES_KEY] as string[] | undefined) ?? []))
      .catch(() => {});
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes[PAUSED_SITES_KEY]) {
        setPausedSites((changes[PAUSED_SITES_KEY].newValue as string[] | undefined) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Resolve active tab ID in sidepanel mode and keep it updated when switching tabs
  useEffect(() => {
    if (mode === 'devtools') {
      if (tabId !== null && typeof chrome !== 'undefined' && chrome.tabs?.get) {
        chrome.tabs
          .get(tabId)
          .then((tab) => {
            if (tab?.url) setTabUrl(tab.url);
          })
          .catch(() => {});
      }
      return;
    }

    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    const queryActiveTab = async () => {
      try {
        const [active] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (active?.id !== undefined) {
          setTabId(active.id);
          setTabUrl(active.url ?? '');
        }
      } catch {
        // Ignore
      }
    };

    queryActiveTab();

    const onActivated = (info: { tabId: number }) => {
      setTabId(info.tabId);
      chrome.tabs
        .get(info.tabId)
        .then((tab) => setTabUrl(tab.url ?? ''))
        .catch(() => {});
    };

    const onUpdated = (
      updatedTabId: number,
      changeInfo: { url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId === tabId && (changeInfo.url || tab.url)) {
        setTabUrl(changeInfo.url ?? tab.url ?? '');
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [mode, tabId]);

  // Connect live port to Service Worker for current tabId
  useEffect(() => {
    if (tabId === null || typeof chrome === 'undefined' || !chrome.runtime?.connect) {
      return;
    }

    const port = chrome.runtime.connect({ name: `tag-companion-ui:${tabId}` });

    const onMessage = (msg: RuntimeMessage) => {
      if (msg.type === 'SESSION_UPDATE' && msg.tabId === tabId) {
        setSession(msg.session);
        if (msg.session.currentUrl) {
          setTabUrl(msg.session.currentUrl);
        }
      }
    };

    port.onMessage.addListener(onMessage);

    // Fallback initial request
    chrome.runtime
      .sendMessage({ type: 'GET_SESSION', tabId } satisfies RuntimeMessage)
      .then((res) => {
        if (res?.session) {
          setSession(res.session as TabSession);
        } else {
          setSession(createTabSession(tabId, tabUrl));
        }
      })
      .catch(() => {
        setSession(createTabSession(tabId, tabUrl));
      });

    return () => {
      port.onMessage.removeListener(onMessage);
      port.disconnect();
    };
  }, [tabId]);

  const currentUrl = session?.currentUrl || tabUrl;
  const currentOrigin = extractOrigin(currentUrl);
  const isRestrictedPage = !currentOrigin || !/^https?:\/\//i.test(currentOrigin);

  // Check optional_host_permissions status for current origin
  useEffect(() => {
    if (isRestrictedPage || typeof chrome === 'undefined' || !chrome.permissions) {
      setOriginGranted(false);
      return;
    }

    const check = () =>
      chrome.permissions
        .contains({ origins: [`${currentOrigin}/*`] })
        .then((granted) => setOriginGranted(granted))
        .catch(() => setOriginGranted(false));
    check();
    // Keep the switch honest when access changes in chrome://extensions
    chrome.permissions.onAdded?.addListener(check);
    chrome.permissions.onRemoved?.addListener(check);
    return () => {
      chrome.permissions.onAdded?.removeListener(check);
      chrome.permissions.onRemoved?.removeListener(check);
    };
  }, [currentOrigin, isRestrictedPage]);

  const requestOriginPermission = useCallback(async () => {
    if (isRestrictedPage || tabId === null || typeof chrome === 'undefined') {
      return false;
    }
    try {
      const originsToRequest = originsForSite(currentOrigin);

      const granted = await chrome.permissions.request({
        origins: [...new Set(originsToRequest)],
      });
      setOriginGranted(granted);
      if (granted) {
        await chrome.runtime.sendMessage({
          type: 'ACTIVATE_ORIGIN',
          tabId,
          origin: currentOrigin,
        } satisfies RuntimeMessage);
      }
      return granted;
    } catch (err) {
      // Never swallow this silently: a rejected request looks like "the button does nothing".
      console.error('Tag Companion: não foi possível pedir a permissão do site', err);
      return false;
    }
  }, [currentOrigin, isRestrictedPage, tabId]);

  const sitePaused = isSitePaused(currentUrl, pausedSites);

  const writePaused = useCallback(async (key: string, paused: boolean) => {
    if (!key || typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const stored = await chrome.storage.local.get(PAUSED_SITES_KEY).catch(() => ({}));
    const list = ((stored as Record<string, unknown>)[PAUSED_SITES_KEY] as string[] | undefined) ?? [];
    const next = paused ? [...new Set([...list, key])] : list.filter((k) => k !== key);
    setPausedSites(next);
    await chrome.storage.local.set({ [PAUSED_SITES_KEY]: next });
  }, []);

  const setMonitoring = useCallback(
    async (on: boolean) => {
      if (isRestrictedPage) return;
      const key = siteKey(currentUrl);
      if (!on) {
        await writePaused(key, true);
        return;
      }
      await writePaused(key, false);
      if (!originGranted) await requestOriginPermission();
    },
    [currentUrl, isRestrictedPage, originGranted, requestOriginPermission, writePaused],
  );

  const clearSession = useCallback(async () => {
    if (tabId === null || typeof chrome === 'undefined') return;
    const res = await chrome.runtime.sendMessage({
      type: 'CLEAR_SESSION',
      tabId,
    } satisfies RuntimeMessage);
    if (res?.session) {
      setSession(res.session as TabSession);
    }
  }, [tabId]);

  const setPreserveLog = useCallback(
    async (preserveLog: boolean) => {
      if (tabId === null || typeof chrome === 'undefined') return;
      setSession((prev) => (prev ? { ...prev, preserveLog } : prev));
      await chrome.runtime.sendMessage({
        type: 'SET_PRESERVE_LOG',
        tabId,
        preserveLog,
      } satisfies RuntimeMessage);
    },
    [tabId],
  );

  return {
    tabId,
    session,
    originGranted,
    sitePaused,
    isRestrictedPage,
    setMonitoring,
    requestOriginPermission,
    clearSession,
    setPreserveLog,
  };
}
