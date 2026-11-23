import type {
  ConsentChangeEvent,
  DataLayerEvent,
  LoadedScript,
  MarketingCookie,
  NavigationEvent,
  PageObserverMessage,
  ParsedHit,
  RawNetworkRequest,
  TabSession,
  TagOrigin,
  TagState,
  TimelineItem,
  VendorGroup,
  VendorId,
} from '@/shared/types';
import {
  createInitialConsent,
  matchMarketingCookie,
  VENDOR_DISPLAY_NAMES,
} from '@/shared/constants';
import {
  buildConsentFromHit,
  mergeConsent,
  parseConsentObject,
  parseIcsEntries,
} from './consent';
import { correlateSession } from './correlator';
import { runDiagnostics } from './diagnostics';
import { parseVendorRequest } from '@/vendors';
import { detectTagOrigin, safeParseUrl } from '@/vendors/utils';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export function extractOrigin(url: string): string {
  const parsed = safeParseUrl(url);
  return parsed ? parsed.origin : '';
}

export function extractClickIds(url: string): { gclid?: string; fbclid?: string } {
  const parsed = safeParseUrl(url);
  if (!parsed) return {};
  const gclid = parsed.searchParams.get('gclid') ?? undefined;
  const fbclid = parsed.searchParams.get('fbclid') ?? undefined;
  return { gclid, fbclid };
}

export function createTabSession(
  tabId: number,
  url = '',
  preserveLog = true,
  now = Date.now(),
): TabSession {
  const clickIds = extractClickIds(url);
  return {
    tabId,
    currentUrl: url,
    origin: extractOrigin(url),
    startedAt: now,
    preserveLog,
    consent: createInitialConsent(now),
    timeline: [],
    scripts: [],
    hits: [],
    dataLayerEvents: [],
    consentHistory: [],
    cookies: [],
    navigations: [],
    clickIds:
      clickIds.gclid || clickIds.fbclid
        ? [{ ...clickIds, detectedAt: now, pageUrl: url }]
        : [],
    diagnostics: [],
    hasServerSideGtm: false,
  };
}

export function clearTabSession(session: TabSession, now = Date.now()): TabSession {
  return createTabSession(session.tabId, session.currentUrl, session.preserveLog, now);
}

export function recordNavigation(
  session: TabSession,
  toUrl: string,
  timestamp = Date.now(),
): TabSession {
  const fromUrl = session.currentUrl;
  const clickIds = extractClickIds(toUrl);

  if (!session.preserveLog) {
    const fresh = createTabSession(session.tabId, toUrl, false, timestamp);
    return fresh;
  }

  session.currentUrl = toUrl;
  session.origin = extractOrigin(toUrl);

  if (clickIds.gclid || clickIds.fbclid) {
    session.clickIds.push({ ...clickIds, detectedAt: timestamp, pageUrl: toUrl });
  }

  if (fromUrl && fromUrl !== toUrl) {
    const navEvent: NavigationEvent = {
      id: nextId('nav'),
      timestamp,
      fromUrl,
      toUrl,
      clickIds,
    };
    session.navigations.push(navEvent);
    pushTimeline(session, {
      kind: 'navigation',
      id: navEvent.id,
      timestamp,
      data: navEvent,
    });
  }

  recomputeDerivedState(session, timestamp);
  return session;
}

export function recordNetworkRequest(
  session: TabSession,
  request: RawNetworkRequest,
): { matched: boolean } {
  const result = parseVendorRequest(request);
  if (!result) return { matched: false };

  const { match, hits } = result;

  if (match.isServerSide) {
    session.hasServerSideGtm = true;
  }

  if (match.kind === 'script') {
    const origin = detectTagOrigin(request, Boolean(match.isServerSide));
    const existing = session.scripts.find(
      (s) =>
        s.vendorId === match.vendorId &&
        (s.accountId ?? '') === (match.accountId ?? '') &&
        s.scriptName === (match.scriptName ?? 'script'),
    );

    if (existing) {
      // Upgrade metadata if devtools provided better status/origin/url
      if (request.statusCode) existing.statusCode = request.statusCode;
      if (origin !== 'unknown') existing.origin = origin;
      if (request.url) existing.url = request.url;
      existing.detectedVia = 'script_request';
    } else {
      const script: LoadedScript = {
        id: nextId('scr'),
        vendorId: match.vendorId,
        vendorName: match.vendorName,
        accountId: match.accountId,
        scriptName: match.scriptName ?? 'script',
        url: request.url,
        detectedVia: 'script_request',
        origin,
        statusCode: request.statusCode,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || session.currentUrl,
      };
      session.scripts.push(script);
      pushTimeline(session, {
        kind: 'script',
        id: script.id,
        timestamp: script.timestamp,
        data: script,
      });
    }

    recomputeDerivedState(session, request.timestamp);
    return { matched: true };
  }

  // Hit(s)
  for (const hit of hits) {
    if (!hit.pageUrl) hit.pageUrl = session.currentUrl;
    if (hit.hasServerSideIndicator) {
      session.hasServerSideGtm = true;
    }

    // Deduplicate/merge when both webRequest and devtools.network report the same request
    const duplicate = findMatchingExistingHit(session.hits, hit);
    if (duplicate) {
      mergeHitUpdate(duplicate, hit);
      applyHitConsent(session, duplicate);
    } else {
      applyHitConsent(session, hit);
      session.hits.push(hit);
      pushTimeline(session, {
        kind: 'hit',
        id: hit.id,
        timestamp: hit.timestamp,
        data: hit,
      });
    }
  }

  recomputeDerivedState(session, request.timestamp);
  return { matched: true };
}

export function recordNetworkCompleted(
  session: TabSession,
  requestId: string,
  statusCode: number,
  timestamp = Date.now(),
): void {
  let changed = false;
  for (const hit of session.hits) {
    if (hit.requestId === requestId) {
      hit.statusCode = statusCode;
      hit.status = statusCode >= 200 && statusCode < 400 ? 'fired' : 'failed';
      changed = true;
    }
  }
  if (changed) {
    recomputeDerivedState(session, timestamp);
  }
}

export function recordNetworkError(
  session: TabSession,
  requestId: string,
  error: string,
  timestamp = Date.now(),
): void {
  let changed = false;
  for (const hit of session.hits) {
    if (hit.requestId === requestId) {
      hit.error = error;
      hit.status = 'failed';
      changed = true;
    }
  }
  if (changed) {
    recomputeDerivedState(session, timestamp);
  }
}

export function recordPageObserverEvent(
  session: TabSession,
  msg: PageObserverMessage,
): void {
  const ts = msg.timestamp || Date.now();
  const pageUrl = msg.pageUrl || session.currentUrl;

  if (msg.type === 'page_context') {
    if (pageUrl) {
      session.currentUrl = pageUrl;
      session.origin = extractOrigin(pageUrl);
    }
    const clickIds = extractClickIds(pageUrl);
    if (clickIds.gclid || clickIds.fbclid) {
      const already = session.clickIds.some(
        (c) =>
          c.gclid === clickIds.gclid &&
          c.fbclid === clickIds.fbclid &&
          Math.abs(c.detectedAt - ts) < 5000,
      );
      if (!already) {
        session.clickIds.push({ ...clickIds, detectedAt: ts, pageUrl });
      }
    }
    if (msg.payload.pageLoaded === true) {
      session.pageLoadedAt = ts;
    }
    recomputeDerivedState(session, ts);
    return;
  }

  if (msg.type === 'vendor_global') {
    const vendorId = msg.payload.vendorId as VendorId | undefined;
    const scriptName = String(msg.payload.scriptName ?? 'global');
    const accountId =
      typeof msg.payload.accountId === 'string' ? msg.payload.accountId : undefined;
    if (!vendorId) return;

    const exists = session.scripts.some(
      (s) =>
        s.vendorId === vendorId &&
        (!accountId || !s.accountId || s.accountId === accountId),
    );
    if (!exists) {
      const script: LoadedScript = {
        id: nextId('scr'),
        vendorId,
        vendorName: VENDOR_DISPLAY_NAMES[vendorId] ?? vendorId,
        accountId,
        scriptName,
        detectedVia: 'global',
        origin: 'unknown',
        timestamp: ts,
        pageUrl,
      };
      session.scripts.push(script);
      pushTimeline(session, {
        kind: 'script',
        id: script.id,
        timestamp: ts,
        data: script,
      });
      recomputeDerivedState(session, ts);
    }
    return;
  }

  if (msg.type === 'consent_command') {
    const commandType =
      msg.payload.commandType === 'default' ? 'default' : 'update';
    const consentObj =
      (msg.payload.consent as Record<string, unknown> | undefined) ?? {};
    const patch = parseConsentObject(consentObj);
    const prev = { ...session.consent };
    const { next, changedKeys } = mergeConsent(session.consent, patch, {
      source: 'gtag',
      timestamp: ts,
    });
    session.consent = next;

    // Also record the dataLayer consent command for transparency
    const dlEvent: DataLayerEvent = {
      id: nextId('dl'),
      timestamp: ts,
      pageUrl,
      eventName: `consent.${commandType}`,
      payload: { command: 'consent', type: commandType, ...consentObj },
      isConsentCommand: true,
      consentCommandType: commandType,
      correlatedHitIds: [],
    };
    session.dataLayerEvents.push(dlEvent);
    pushTimeline(session, {
      kind: 'datalayer',
      id: dlEvent.id,
      timestamp: ts,
      data: dlEvent,
    });

    if (changedKeys.length > 0) {
      recordConsentChange(session, prev, next, changedKeys, 'gtag', ts, pageUrl);
    }
    recomputeDerivedState(session, ts);
    return;
  }

  if (msg.type === 'ics_snapshot') {
    const entries =
      (msg.payload.entries as Record<
        string,
        { default?: boolean; update?: boolean }
      >) ?? {};
    const patch = parseIcsEntries(entries);
    const prev = { ...session.consent };
    const { next, changedKeys } = mergeConsent(session.consent, patch, {
      source: 'ics',
      timestamp: ts,
    });
    session.consent = next;
    if (changedKeys.length > 0) {
      recordConsentChange(session, prev, next, changedKeys, 'ics', ts, pageUrl);
    }
    recomputeDerivedState(session, ts);
    return;
  }

  if (msg.type === 'datalayer_push') {
    const rawPayload =
      (msg.payload.data as Record<string, unknown> | undefined) ?? msg.payload;
    const eventName =
      typeof rawPayload.event === 'string' && rawPayload.event.trim()
        ? rawPayload.event.trim()
        : 'dataLayer.push';
    const eventId = extractEventIdFromPayload(rawPayload);

    const dlEvent: DataLayerEvent = {
      id: nextId('dl'),
      timestamp: ts,
      pageUrl,
      eventName,
      eventId,
      payload: rawPayload,
      correlatedHitIds: [],
    };
    session.dataLayerEvents.push(dlEvent);
    pushTimeline(session, {
      kind: 'datalayer',
      id: dlEvent.id,
      timestamp: ts,
      data: dlEvent,
    });
    recomputeDerivedState(session, ts);
  }
}

export function recordCookie(
  session: TabSession,
  input: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expirationDate?: number;
    timestamp?: number;
    isSnapshot?: boolean;
  },
): void {
  const def = matchMarketingCookie(input.name);
  if (!def) return;

  const ts = input.timestamp ?? Date.now();
  const existing = session.cookies.find(
    (c) => c.name === input.name && c.domain === input.domain,
  );

  const consentAtCreation = { ...session.consent };
  const requiredConsent = def.requiresConsent;
  const createdBeforeConsent = consentAtCreation[requiredConsent] === 'denied';

  if (existing) {
    existing.value = input.value;
    existing.updatedAt = ts;
    existing.expirationDate = input.expirationDate;
    recomputeDerivedState(session, ts);
    return;
  }

  const cookie: MarketingCookie = {
    id: nextId('ck'),
    name: input.name,
    vendorId: def.vendorId,
    vendorName: def.vendorName,
    domain: input.domain,
    path: input.path,
    value: input.value,
    createdAt: ts,
    updatedAt: ts,
    expirationDate: input.expirationDate,
    consentAtCreation,
    createdBeforeConsent,
    pageUrl: session.currentUrl,
  };

  session.cookies.push(cookie);
  if (!input.isSnapshot) {
    pushTimeline(session, {
      kind: 'cookie',
      id: cookie.id,
      timestamp: ts,
      data: cookie,
    });
  }
  recomputeDerivedState(session, ts);
}

export function recomputeDerivedState(session: TabSession, now = Date.now()): void {
  correlateSession(session.dataLayerEvents, session.hits);
  session.diagnostics = runDiagnostics(session, now);
}

/**
 * Builds the "Por Vendor" view groups strictly separating the 4 states from the PRD:
 * - loaded (script loaded, e.g. GTM container)
 * - fired (script loaded + at least 1 fired hit)
 * - failed (contains failed hit)
 * - loaded_no_fire (script loaded, 0 hits)
 */
export function buildVendorGroups(session: TabSession): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();

  const getGroupKey = (vendorId: VendorId, accountId?: string): string => {
    return accountId ? `${vendorId}::${accountId}` : vendorId;
  };

  // Helper to attach to existing accountless vendor group or create specific group
  const findOrCreateGroup = (
    vendorId: VendorId,
    vendorName: string,
    accountId: string | undefined,
    origin: TagOrigin,
  ): VendorGroup => {
    const exactKey = getGroupKey(vendorId, accountId);
    const existingExact = groups.get(exactKey);
    if (existingExact) return existingExact;

    // If we have an accountId now and previously created an accountless script group for same vendor, promote it
    if (accountId) {
      const generic = groups.get(vendorId);
      if (generic && !generic.accountId) {
        groups.delete(vendorId);
        generic.key = exactKey;
        generic.accountId = accountId;
        groups.set(exactKey, generic);
        return generic;
      }
    }

    // If we don't have an accountId, attach to first group of same vendor if one exists
    if (!accountId) {
      for (const g of groups.values()) {
        if (g.vendorId === vendorId) return g;
      }
    }

    const group: VendorGroup = {
      key: exactKey,
      vendorId,
      vendorName,
      accountId,
      state: 'loaded',
      scripts: [],
      hits: [],
      origin,
    };
    groups.set(exactKey, group);
    return group;
  };

  for (const script of session.scripts) {
    const group = findOrCreateGroup(
      script.vendorId,
      script.vendorName,
      script.accountId,
      script.origin,
    );
    group.scripts.push(script);
    if (group.origin === 'unknown' && script.origin !== 'unknown') {
      group.origin = script.origin;
    }
  }

  for (const hit of session.hits) {
    const group = findOrCreateGroup(
      hit.vendorId,
      hit.vendorName,
      hit.accountId,
      hit.origin,
    );
    group.hits.push(hit);
    if (hit.origin === 'sgtm') {
      group.origin = 'sgtm';
    } else if (group.origin === 'unknown' && hit.origin !== 'unknown') {
      group.origin = hit.origin;
    }
  }

  for (const group of groups.values()) {
    group.state = computeGroupState(group);
  }

  return [...groups.values()];
}

function computeGroupState(group: VendorGroup): TagState {
  if (group.vendorId === 'gtm') {
    return 'loaded';
  }
  if (group.hits.length === 0) {
    return 'loaded_no_fire';
  }
  const hasFailed = group.hits.some((h) => h.status === 'failed');
  const hasFired = group.hits.some((h) => h.status === 'fired');
  if (hasFailed && !hasFired) return 'failed';
  return 'fired';
}

function findMatchingExistingHit(
  hits: ParsedHit[],
  incoming: ParsedHit,
): ParsedHit | undefined {
  // Exact requestId + index match
  const byId = hits.find((h) => h.id === incoming.id);
  if (byId) return byId;

  // Cross-source merge (webRequest vs devtools.network) within 1.5s for same URL & event
  return hits.find(
    (h) =>
      h.source !== incoming.source &&
      h.vendorId === incoming.vendorId &&
      h.url === incoming.url &&
      h.eventName === incoming.eventName &&
      Math.abs(h.timestamp - incoming.timestamp) <= 1500,
  );
}

function mergeHitUpdate(target: ParsedHit, incoming: ParsedHit): void {
  // Devtools often has fuller POST body params and initiator stack trace
  if (incoming.params.length > target.params.length) {
    target.params = incoming.params;
    target.rawParams = incoming.rawParams;
  }
  if (incoming.origin !== 'unknown') {
    target.origin = incoming.origin;
  }
  if (incoming.accountId && !target.accountId) {
    target.accountId = incoming.accountId;
  }
  if (incoming.eventId && !target.eventId) {
    target.eventId = incoming.eventId;
  }
  if (incoming.gcs && !target.gcs) {
    target.gcs = incoming.gcs;
  }
  if (incoming.gcd && !target.gcd) {
    target.gcd = incoming.gcd;
  }
  if (incoming.status !== 'pending' && target.status === 'pending') {
    target.status = incoming.status;
  }
  if (incoming.statusCode && !target.statusCode) {
    target.statusCode = incoming.statusCode;
  }
  if (incoming.error && !target.error) {
    target.error = incoming.error;
    target.status = 'failed';
  }
}

function applyHitConsent(session: TabSession, hit: ParsedHit): void {
  const prev = { ...session.consent };
  const { hitConsent, merged } = buildConsentFromHit(
    session.consent,
    hit.gcs,
    hit.gcd,
    hit.timestamp,
  );
  hit.consentAtHit = hitConsent;
  if (merged.changedKeys.length > 0) {
    session.consent = merged.next;
    recordConsentChange(
      session,
      prev,
      merged.next,
      merged.changedKeys,
      merged.next.source,
      hit.timestamp,
      hit.pageUrl || session.currentUrl,
    );
  }
}

function recordConsentChange(
  session: TabSession,
  previous: TabSession['consent'],
  current: TabSession['consent'],
  changedKeys: ConsentChangeEvent['changedKeys'],
  source: ConsentChangeEvent['source'],
  timestamp: number,
  pageUrl: string,
): void {
  const change: ConsentChangeEvent = {
    id: nextId('cns'),
    timestamp,
    pageUrl,
    source,
    previous,
    current: { ...current },
    changedKeys,
  };
  session.consentHistory.push(change);
  pushTimeline(session, {
    kind: 'consent',
    id: change.id,
    timestamp,
    data: change,
  });
}

function pushTimeline(session: TabSession, item: TimelineItem): void {
  session.timeline.push(item);
  // Keep timeline bounded for long-running sessions (max 1500 entries)
  if (session.timeline.length > 1500) {
    session.timeline.splice(0, session.timeline.length - 1500);
  }
}

function extractEventIdFromPayload(
  payload: Record<string, unknown>,
): string | undefined {
  const candidates = [
    payload.event_id,
    payload.eventId,
    payload.eid,
    (payload.ecommerce as Record<string, unknown> | undefined)?.transaction_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return undefined;
}
