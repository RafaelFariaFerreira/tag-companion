import type { VendorModule, VendorMatch } from './types';
import type { ParsedHit, RawNetworkRequest } from '@/shared/types';
import {
  buildDecodedParam,
  detectTagOrigin,
  extractQueryParams,
  flattenObject,
  getEndpointPath,
  inferHitStatus,
  parseFormEncoded,
  parseJsonSafe,
  safeParseUrl,
} from './utils';

// Phase 2 vendors: TikTok, Reddit, X, Mixpanel

export const tiktokVendor: VendorModule = {
  id: 'tiktok',
  name: 'TikTok Pixel',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (!/(^|\.)analytics\.tiktok\.com$/i.test(host)) return null;

    if (/\/events\.js$/i.test(path)) {
      return {
        vendorId: 'tiktok',
        vendorName: 'TikTok Pixel',
        kind: 'script',
        scriptName: 'events.js',
        accountId: parsed.searchParams.get('sdkid') ?? undefined,
      };
    }

    if (/\/api\/v\d+\/pixel/i.test(path) && resourceType !== 'script') {
      return {
        vendorId: 'tiktok',
        vendorName: 'TikTok Pixel',
        kind: 'hit',
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];
    const queryParams = extractQueryParams(parsed);
    const json = request.requestBody ? parseJsonSafe(request.requestBody) : null;
    const bodyParams = json ? flattenObject(json) : {};
    const rawParams = { ...queryParams, ...bodyParams };

    const accountId = rawParams['context.pixel.code'] || rawParams.pixel_code || rawParams.sdkid;
    const eventName = rawParams.event || 'PageView';
    const eventId = rawParams.event_id || undefined;

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'tiktok',
        vendorName: 'TikTok Pixel',
        category: 'ads',
        accountId,
        eventName,
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || rawParams['context.page.url'] || '',
        origin: detectTagOrigin(request, false),
        params: Object.entries(rawParams).map(([k, v]) =>
          buildDecodedParam(k, v, tiktokVendor.label),
        ),
        rawParams,
        eventId,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    const map: Record<string, string> = {
      event: 'Evento',
      event_id: 'ID do evento (deduplicação)',
      pixel_code: 'ID do TikTok Pixel',
      'context.pixel.code': 'ID do TikTok Pixel',
      'context.page.url': 'URL da página',
    };
    return map[param] ?? param;
  },
};

export const redditVendor: VendorModule = {
  id: 'reddit',
  name: 'Reddit Pixel',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (/(^|\.)redditstatic\.com$/i.test(host) && /\/ads\/pixel\.js$/i.test(path)) {
      return {
        vendorId: 'reddit',
        vendorName: 'Reddit Pixel',
        kind: 'script',
        scriptName: 'pixel.js',
      };
    }

    if (/(^|\.)alb\.reddit\.com$/i.test(host) && /\/rp\.gif$/i.test(path) && resourceType !== 'script') {
      return {
        vendorId: 'reddit',
        vendorName: 'Reddit Pixel',
        kind: 'hit',
        accountId: parsed.searchParams.get('id') ?? undefined,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];
    const rawParams = extractQueryParams(parsed);
    const accountId = rawParams.id || undefined;
    const eventName = rawParams.event || 'PageVisit';
    const eventId = rawParams.conversion_id || undefined;

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'reddit',
        vendorName: 'Reddit Pixel',
        category: 'ads',
        accountId,
        eventName,
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || '',
        origin: detectTagOrigin(request, false),
        params: Object.entries(rawParams).map(([k, v]) =>
          buildDecodedParam(k, v, redditVendor.label),
        ),
        rawParams,
        eventId,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    const map: Record<string, string> = {
      id: 'ID do Reddit Pixel',
      event: 'Evento',
      conversion_id: 'ID da conversão',
    };
    return map[param] ?? param;
  },
};

export const xPixelVendor: VendorModule = {
  id: 'x_pixel',
  name: 'X Pixel',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (/(^|\.)static\.ads-twitter\.com$/i.test(host) && /\/uwt\.js$/i.test(path)) {
      return {
        vendorId: 'x_pixel',
        vendorName: 'X Pixel',
        kind: 'script',
        scriptName: 'uwt.js',
      };
    }

    if (
      (/(^|\.)analytics\.twitter\.com$/i.test(host) || /(^|\.)t\.co$/i.test(host)) &&
      /\/i\/adsct/i.test(path) &&
      resourceType !== 'script'
    ) {
      return {
        vendorId: 'x_pixel',
        vendorName: 'X Pixel',
        kind: 'hit',
        accountId: parsed.searchParams.get('txn_id') ?? undefined,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];
    const rawParams = extractQueryParams(parsed);
    const accountId = rawParams.txn_id || undefined;
    const eventName = rawParams.ev || rawParams.event || 'PageView';

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'x_pixel',
        vendorName: 'X Pixel',
        category: 'ads',
        accountId,
        eventName,
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || '',
        origin: detectTagOrigin(request, false),
        params: Object.entries(rawParams).map(([k, v]) =>
          buildDecodedParam(k, v, xPixelVendor.label),
        ),
        rawParams,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    const map: Record<string, string> = {
      txn_id: 'ID do X Pixel',
      ev: 'Evento',
    };
    return map[param] ?? param;
  },
};

export const mixpanelVendor: VendorModule = {
  id: 'mixpanel',
  name: 'Mixpanel',
  category: 'analytics',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (/(^|\.)cdn\.mxpnl\.com$/i.test(host)) {
      return {
        vendorId: 'mixpanel',
        vendorName: 'Mixpanel',
        kind: 'script',
        scriptName: 'mixpanel.min.js',
      };
    }

    if (/(^|\.)api(-js|-eu)?\.mixpanel\.com$/i.test(host) && /\/track/i.test(path) && resourceType !== 'script') {
      return {
        vendorId: 'mixpanel',
        vendorName: 'Mixpanel',
        kind: 'hit',
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const queryParams = extractQueryParams(parsed);
    const bodyParams = request.requestBody ? parseFormEncoded(request.requestBody) : {};
    const dataRaw = bodyParams.data || queryParams.data;

    let decodedEvents: Array<{ event?: string; properties?: Record<string, unknown> }> = [];
    if (dataRaw) {
      try {
        const jsonStr = dataRaw.trim().startsWith('[') || dataRaw.trim().startsWith('{')
          ? dataRaw
          : atob(dataRaw);
        const parsedData = JSON.parse(jsonStr);
        decodedEvents = Array.isArray(parsedData) ? parsedData : [parsedData];
      } catch {
        // Ignore decode failure
      }
    }

    if (decodedEvents.length === 0) {
      decodedEvents = [{ event: 'track', properties: {} }];
    }

    return decodedEvents.map((ev, index) => {
      const flat = flattenObject((ev.properties ?? {}) as Record<string, unknown>);
      const accountId = flat.token || undefined;
      const eventName = ev.event || 'track';
      const rawParams = { event: eventName, ...flat };

      return {
        id: `${request.requestId}#${index}`,
        requestId: request.requestId,
        vendorId: 'mixpanel',
        vendorName: 'Mixpanel',
        category: 'analytics',
        accountId,
        eventName,
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || flat.$current_url || '',
        origin: detectTagOrigin(request, false),
        params: Object.entries(rawParams).map(([k, v]) =>
          buildDecodedParam(k, v, mixpanelVendor.label),
        ),
        rawParams,
        eventId: flat.$insert_id || undefined,
        source: request.source,
      };
    });
  },

  label(param: string): string {
    const map: Record<string, string> = {
      event: 'Evento',
      token: 'Token do projeto Mixpanel',
      distinct_id: 'Distinct ID',
      $current_url: 'URL da página',
    };
    return map[param] ?? param;
  },
};
