import type { PageObserverMessage, RuntimeMessage } from '@/shared/types';

const BRIDGE_INSTALLED_FLAG = '__TAG_COMPANION_BRIDGE_INSTALLED__';

if (!(window as unknown as Record<string, unknown>)[BRIDGE_INSTALLED_FLAG]) {
  (window as unknown as Record<string, unknown>)[BRIDGE_INSTALLED_FLAG] = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as PageObserverMessage | undefined;
    if (!data || data.source !== 'tag-companion-main') return;

    const msg: RuntimeMessage = {
      type: 'PAGE_OBSERVER_EVENT',
      event: data,
    };

    try {
      chrome.runtime.sendMessage(msg).catch(() => {
        // Ignore when service worker is reloading or extension context invalidated
      });
    } catch {
      // Extension context may be invalidated after reload
    }
  });
}
