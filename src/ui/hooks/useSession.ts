import { useCallback, useEffect, useState } from 'react';
import type { RuntimeMessage, TabSession } from '@/shared/types';
import { createTabSession, extractOrigin } from '@/core/session-store';
import { activatedSitePatterns, originsForSite } from '@/shared/site-access';

export interface UseSessionResult {
  tabId: number | null;
  session: TabSession | null;
  originGranted: boolean;
  isRestrictedPage: boolean;
  /** The header switch: off revokes every activated site; on asks for the open site only. */
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

  const setMonitoring = useCallback(
    async (on: boolean) => {
      if (typeof chrome === 'undefined' || !chrome.permissions) return;
      if (on) {
        if (!isRestrictedPage && !originGranted) await requestOriginPermission();
        return;
      }
      // Off = revoke every activated site, so turning it back on asks again, one site at a time.
      try {
        const { origins = [] } = await chrome.permissions.getAll();
        const toRevoke = activatedSitePatterns(origins, chrome.runtime.getManifest().host_permissions ?? []);
        // One by one: a single refused pattern must not keep the other sites granted.
        for (const origin of toRevoke) {
          await chrome.permissions.remove({ origins: [origin] }).catch((err) => {
            console.error(`Tag Companion: não foi possível remover a permissão de ${origin}`, err);
          });
        }
      } catch (err) {
        console.error('Tag Companion: não foi possível remover as permissões dos sites', err);
      }
      if (!isRestrictedPage && currentOrigin) {
        setOriginGranted(await chrome.permissions.contains({ origins: [`${currentOrigin}/*`] }).catch(() => false));
      }
    },
    [currentOrigin, isRestrictedPage, originGranted, requestOriginPermission],
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
    isRestrictedPage,
    setMonitoring,
    requestOriginPermission,
    clearSession,
    setPreserveLog,
  };
}
