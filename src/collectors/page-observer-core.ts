import type { PageObserverMessage, VendorId } from '@/shared/types';

const WRAPPED_SYMBOL = Symbol.for('__tag_debugger_wrapped_push__');
const INSTALLED_FLAG = '__TAG_COMPANION_OBSERVER_INSTALLED__';

type AnyPush = ((...args: unknown[]) => number) & {
  [WRAPPED_SYMBOL]?: boolean;
};

interface MutableWindow extends Record<string, unknown> {
  location: Location;
  postMessage: Window['postMessage'];
  addEventListener: Window['addEventListener'];
  setTimeout: typeof setTimeout;
  dataLayer?: unknown[];
  google_tag_manager?: Record<string, unknown>;
  google_tag_data?: {
    ics?: {
      entries?: Record<string, { default?: boolean; update?: boolean; implicit?: boolean }>;
    };
  };
  fbq?: ((...args: unknown[]) => void) & {
    getState?: () => { pixels?: Array<{ id?: string }> };
  };
  clarity?: unknown;
  _linkedin_data_partner_ids?: Array<string | number>;
  _hsq?: unknown[];
  ttq?: unknown;
  rdt?: unknown;
  twq?: unknown;
  mixpanel?: unknown;
}

/**
 * Fast, safe serializer bounded by depth and key count (< 1ms per push).
 * Avoids circular references, DOM nodes, functions, and huge objects.
 */
export function safeClone(value: unknown, depth = 4, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string') {
    return (value as string).length > 500
      ? `${(value as string).slice(0, 500)}…`
      : value;
  }
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'function') return '[Function]';
  if (type === 'symbol' || type === 'bigint') return String(value);

  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';
    if (depth <= 0) return '[MaxDepth]';

    // Avoid cloning DOM nodes or Window
    if (
      'nodeType' in obj &&
      typeof (obj as { nodeType?: unknown }).nodeType === 'number'
    ) {
      return `[Element ${(obj as { tagName?: string }).tagName ?? ''}]`.trim();
    }
    if ('window' in obj && (obj as { window?: unknown }).window === obj) {
      return '[Window]';
    }

    seen.add(obj);

    if (Array.isArray(obj)) {
      const limit = Math.min(obj.length, 30);
      const arr: unknown[] = [];
      for (let i = 0; i < limit; i++) {
        arr.push(safeClone(obj[i], depth - 1, seen));
      }
      return arr;
    }

    // Handle Arguments objects (used by gtag -> dataLayer.push(arguments))
    if (Object.prototype.toString.call(obj) === '[object Arguments]') {
      const args = Array.from(obj as ArrayLike<unknown>);
      return args.slice(0, 10).map((a) => safeClone(a, depth - 1, seen));
    }

    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).slice(0, 50);
    for (const k of keys) {
      try {
        out[k] = safeClone((obj as Record<string, unknown>)[k], depth - 1, seen);
      } catch {
        out[k] = '[Unreadable]';
      }
    }
    return out;
  }

  return undefined;
}

export function installPageObserver(rawWin: unknown): void {
  const win = rawWin as MutableWindow;
  if (!win || win[INSTALLED_FLAG]) return;
  win[INSTALLED_FLAG] = true;

  const reportedGlobals = new Set<string>();
  let lastIcsHash = '';

  const emit = (type: PageObserverMessage['type'], payload: Record<string, unknown>) => {
    const msg: PageObserverMessage = {
      source: 'tag-companion-main',
      type,
      timestamp: Date.now(),
      pageUrl: win.location?.href ?? '',
      payload,
    };
    try {
      win.postMessage(msg, '*');
    } catch {
      // Ignore cross-origin / postMessage failures
    }
  };

  const handleDataLayerItem = (item: unknown) => {
    if (!item || typeof item !== 'object') return;

    // Case 1: gtag() pushed an Arguments object or array: ['consent', 'default'|'update', { ... }]
    const isArgs =
      Array.isArray(item) ||
      Object.prototype.toString.call(item) === '[object Arguments]';

    if (isArgs) {
      const tuple = Array.from(item as ArrayLike<unknown>);
      const cmd = tuple[0];
      if (cmd === 'consent' && (tuple[1] === 'default' || tuple[1] === 'update')) {
        const consentObj =
          tuple[2] && typeof tuple[2] === 'object'
            ? (safeClone(tuple[2], 2) as Record<string, unknown>)
            : {};
        emit('consent_command', {
          commandType: tuple[1],
          consent: consentObj,
        });
        return;
      }
      if (cmd === 'event' && typeof tuple[1] === 'string') {
        const params =
          tuple[2] && typeof tuple[2] === 'object'
            ? (safeClone(tuple[2], 3) as Record<string, unknown>)
            : {};
        emit('datalayer_push', {
          data: { event: tuple[1], ...params, _via: 'gtag' },
        });
        return;
      }
      return;
    }

    // Case 2: Standard dataLayer object push
    const cloned = safeClone(item, 4);
    if (cloned && typeof cloned === 'object' && !Array.isArray(cloned)) {
      emit('datalayer_push', { data: cloned as Record<string, unknown> });
    }
  };

  const wrapDataLayerArray = (dl: unknown[], replayExisting: boolean) => {
    if (!Array.isArray(dl)) return;

    if (replayExisting && dl.length > 0) {
      for (let i = 0; i < dl.length; i++) {
        handleDataLayerItem(dl[i]);
      }
    }

    let currentPush: AnyPush = dl.push as AnyPush;

    const createWrappedPush = (targetPush: AnyPush): AnyPush => {
      if (targetPush && targetPush[WRAPPED_SYMBOL]) {
        return targetPush;
      }
      const wrapped: AnyPush = function (this: unknown, ...args: unknown[]) {
        for (let i = 0; i < args.length; i++) {
          handleDataLayerItem(args[i]);
        }
        const res = targetPush.apply(this, args);
        // Re-verify wrapper wasn't replaced during push execution (GTM risk mitigation)
        if ((dl.push as AnyPush) !== wrapped && !(dl.push as AnyPush)?.[WRAPPED_SYMBOL]) {
          installPushHook(dl.push as AnyPush);
        }
        return res;
      };
      wrapped[WRAPPED_SYMBOL] = true;
      return wrapped;
    };

    const installPushHook = (fn: AnyPush) => {
      currentPush = createWrappedPush(fn);
    };

    installPushHook(currentPush);

    try {
      Object.defineProperty(dl, 'push', {
        configurable: true,
        enumerable: false,
        get() {
          return currentPush;
        },
        set(newPush: unknown) {
          if (typeof newPush === 'function') {
            installPushHook(newPush as AnyPush);
          }
        },
      });
    } catch {
      // Fallback if defineProperty is blocked
      dl.push = currentPush;
    }
  };

  // Intercept window.dataLayer assignment so we survive `window.dataLayer = window.dataLayer || []`
  let currentDataLayer: unknown[] | undefined = Array.isArray(win.dataLayer)
    ? win.dataLayer
    : undefined;

  if (currentDataLayer) {
    wrapDataLayerArray(currentDataLayer, true);
  }

  try {
    Object.defineProperty(win, 'dataLayer', {
      configurable: true,
      enumerable: true,
      get() {
        return currentDataLayer;
      },
      set(val: unknown) {
        if (Array.isArray(val)) {
          const isNew = val !== currentDataLayer;
          currentDataLayer = val;
          wrapDataLayerArray(val, isNew);
        } else {
          currentDataLayer = val as unknown[] | undefined;
        }
      },
    });
  } catch {
    // Fallback if window.dataLayer is non-configurable
  }

  const reportGlobal = (vendorId: VendorId, scriptName: string, accountId?: string) => {
    const key = `${vendorId}:${accountId ?? ''}`;
    if (reportedGlobals.has(key)) return;
    reportedGlobals.add(key);
    emit('vendor_global', { vendorId, scriptName, accountId });
  };

  const scanGlobalsAndIcs = () => {
    // GTM containers
    if (win.google_tag_manager && typeof win.google_tag_manager === 'object') {
      for (const key of Object.keys(win.google_tag_manager)) {
        if (/^GTM-[A-Z0-9]+$/i.test(key)) {
          reportGlobal('gtm', 'gtm.js', key);
        } else if (/^G-[A-Z0-9]+$/i.test(key)) {
          reportGlobal('ga4', 'gtag/js', key);
        } else if (/^AW-[0-9]+$/i.test(key)) {
          reportGlobal('google_ads', 'gtag/js', key);
        }
      }
    }

    // Meta Pixel
    if (typeof win.fbq === 'function') {
      let pixelId: string | undefined;
      try {
        const state = win.fbq.getState?.();
        pixelId = state?.pixels?.[0]?.id;
      } catch {
        // ignore
      }
      reportGlobal('meta_pixel', 'fbevents.js', pixelId);
    }

    // Microsoft Clarity
    if (typeof win.clarity === 'function') {
      reportGlobal('clarity', 'clarity.ms/tag');
    }

    // LinkedIn Insight
    if (Array.isArray(win._linkedin_data_partner_ids) && win._linkedin_data_partner_ids.length > 0) {
      reportGlobal('linkedin', 'insight.min.js', String(win._linkedin_data_partner_ids[0]));
    }

    // HubSpot
    if (Array.isArray(win._hsq)) {
      reportGlobal('hubspot', 'hs-scripts.com');
    }

    // Phase 2 globals
    if (win.ttq) reportGlobal('tiktok', 'events.js');
    if (typeof win.rdt === 'function') reportGlobal('reddit', 'pixel.js');
    if (typeof win.twq === 'function') reportGlobal('x_pixel', 'uwt.js');
    if (win.mixpanel) reportGlobal('mixpanel', 'mixpanel.min.js');

    // Complementary consent snapshot from window.google_tag_data.ics
    const entries = win.google_tag_data?.ics?.entries;
    if (entries && typeof entries === 'object') {
      const compact: Record<string, { default?: boolean; update?: boolean }> = {};
      for (const key of [
        'ad_storage',
        'analytics_storage',
        'ad_user_data',
        'ad_personalization',
      ]) {
        const entry = entries[key];
        if (entry && typeof entry === 'object') {
          compact[key] = {
            default: typeof entry.default === 'boolean' ? entry.default : undefined,
            update: typeof entry.update === 'boolean' ? entry.update : undefined,
          };
        }
      }
      const hash = JSON.stringify(compact);
      if (hash !== '{}' && hash !== lastIcsHash) {
        lastIcsHash = hash;
        emit('ics_snapshot', { entries: compact });
      }
    }
  };

  // Emit initial page context (captures gclid/fbclid immediately)
  emit('page_context', { pageLoaded: false });
  scanGlobalsAndIcs();

  win.addEventListener?.('DOMContentLoaded', () => {
    scanGlobalsAndIcs();
  });

  win.addEventListener?.('load', () => {
    emit('page_context', { pageLoaded: true });
    scanGlobalsAndIcs();
    win.setTimeout?.(scanGlobalsAndIcs, 1500);
  });
}
