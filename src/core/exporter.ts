import type {
  DataLayerEvent,
  MarketingCookie,
  ParsedHit,
  TabSession,
  TimelineItem,
} from '@/shared/types';
import { buildVendorGroups } from './session-store';
import { maskObjectDeep, maskPiiString, maskUrl } from './pii';

export interface ExportedSession {
  schemaVersion: '1.0';
  exportedAt: string;
  piiMasked: boolean;
  page: {
    url: string;
    origin: string;
    preserveLog: boolean;
    hasServerSideGtm: boolean;
  };
  summary: {
    scriptsLoaded: number;
    hitsTotal: number;
    hitsFired: number;
    hitsFailed: number;
    dataLayerEvents: number;
    cookiesTracked: number;
    diagnosticsHigh: number;
    diagnosticsMedium: number;
    diagnosticsLow: number;
  };
  consent: TabSession['consent'];
  vendorGroups: ReturnType<typeof buildVendorGroups>;
  diagnostics: TabSession['diagnostics'];
  cookies: MarketingCookie[];
  timeline: TimelineItem[];
}

function sanitizeHit(hit: ParsedHit): ParsedHit {
  return {
    ...hit,
    url: maskUrl(hit.url),
    pageUrl: maskUrl(hit.pageUrl),
    params: hit.params.map((p) => ({
      ...p,
      value: maskPiiString(p.value, p.key),
    })),
    rawParams: Object.fromEntries(
      Object.entries(hit.rawParams).map(([k, v]) => [k, maskPiiString(v, k)]),
    ),
  };
}

function sanitizeDataLayerEvent(ev: DataLayerEvent): DataLayerEvent {
  return {
    ...ev,
    pageUrl: maskUrl(ev.pageUrl),
    payload: maskObjectDeep(ev.payload),
  };
}

function sanitizeCookie(cookie: MarketingCookie): MarketingCookie {
  return {
    ...cookie,
    pageUrl: maskUrl(cookie.pageUrl),
    value:
      cookie.value.length > 10
        ? `${cookie.value.slice(0, 6)}…${cookie.value.slice(-4)}`
        : '***',
  };
}

function sanitizeTimelineItem(item: TimelineItem): TimelineItem {
  switch (item.kind) {
    case 'hit':
      return { ...item, data: sanitizeHit(item.data) };
    case 'datalayer':
      return { ...item, data: sanitizeDataLayerEvent(item.data) };
    case 'cookie':
      return { ...item, data: sanitizeCookie(item.data) };
    case 'script':
      return {
        ...item,
        data: {
          ...item.data,
          url: item.data.url ? maskUrl(item.data.url) : undefined,
          pageUrl: maskUrl(item.data.pageUrl),
        },
      };
    case 'navigation':
      return {
        ...item,
        data: {
          ...item.data,
          fromUrl: item.data.fromUrl ? maskUrl(item.data.fromUrl) : undefined,
          toUrl: maskUrl(item.data.toUrl),
        },
      };
    case 'consent':
      return {
        ...item,
        data: {
          ...item.data,
          pageUrl: maskUrl(item.data.pageUrl),
        },
      };
  }
}

export function exportSession(
  session: TabSession,
  options: { maskPii?: boolean } = {},
): ExportedSession {
  const maskPii = options.maskPii ?? true;

  const vendorGroups = buildVendorGroups(session).map((g) => ({
    ...g,
    hits: maskPii ? g.hits.map(sanitizeHit) : g.hits,
  }));

  const timeline = maskPii
    ? session.timeline.map(sanitizeTimelineItem)
    : session.timeline;

  const cookies = maskPii
    ? session.cookies.map(sanitizeCookie)
    : session.cookies;

  return {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    piiMasked: maskPii,
    page: {
      url: maskPii ? maskUrl(session.currentUrl) : session.currentUrl,
      origin: session.origin,
      preserveLog: session.preserveLog,
      hasServerSideGtm: session.hasServerSideGtm,
    },
    summary: {
      scriptsLoaded: session.scripts.length,
      hitsTotal: session.hits.length,
      hitsFired: session.hits.filter((h) => h.status === 'fired').length,
      hitsFailed: session.hits.filter((h) => h.status === 'failed').length,
      dataLayerEvents: session.dataLayerEvents.length,
      cookiesTracked: session.cookies.length,
      diagnosticsHigh: session.diagnostics.filter((d) => d.severity === 'high').length,
      diagnosticsMedium: session.diagnostics.filter((d) => d.severity === 'medium').length,
      diagnosticsLow: session.diagnostics.filter((d) => d.severity === 'low').length,
    },
    consent: session.consent,
    vendorGroups,
    diagnostics: session.diagnostics,
    cookies,
    timeline,
  };
}
