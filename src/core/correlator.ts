import type { DataLayerEvent, ParsedHit } from '@/shared/types';
import { CORRELATION_WINDOW_MS, SEMANTIC_EVENT_EQUIVALENTS } from '@/shared/constants';

const INTERNAL_GTM_EVENTS = new Set([
  'gtm.js',
  'gtm.dom',
  'gtm.load',
  'gtm.click',
  'gtm.linkClick',
  'gtm.scrollDepth',
  'gtm.timer',
  'gtm.historyChange',
]);

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function areEventsSemanticallyRelated(dlEventName: string, hitEventName: string): boolean {
  const dlNorm = normalizeName(dlEventName);
  const hitNorm = normalizeName(hitEventName);

  if (dlNorm === hitNorm) return true;
  if (dlNorm.replace(/_/g, '') === hitNorm.replace(/_/g, '')) return true;

  for (const [canonical, aliases] of Object.entries(SEMANTIC_EVENT_EQUIVALENTS)) {
    const normalizedAliases = [canonical, ...aliases].map(normalizeName);
    if (normalizedAliases.includes(dlNorm) && normalizedAliases.includes(hitNorm)) {
      return true;
    }
  }

  return false;
}

export interface CorrelationMatch {
  eventId: string;
  reason: 'event_id' | 'time_window';
}

/**
 * Finds the best matching dataLayer event for a vendor hit:
 * 1. Exact `event_id` match (preferred, even slightly outside tight timing).
 * 2. Temporal window of 3s (0 <= hit.timestamp - event.timestamp <= 3000ms),
 *    preferring semantic event name match, then custom non-internal dataLayer events,
 *    then most recent event before the hit.
 */
export function findCorrelatedEventForHit(
  hit: ParsedHit,
  dataLayerEvents: DataLayerEvent[],
): CorrelationMatch | null {
  if (dataLayerEvents.length === 0) return null;

  // 1. Exact event_id match
  if (hit.eventId) {
    for (let i = dataLayerEvents.length - 1; i >= 0; i--) {
      const ev = dataLayerEvents[i];
      if (ev.eventId && ev.eventId === hit.eventId) {
        return { eventId: ev.id, reason: 'event_id' };
      }
    }
  }

  // 2. Temporal window (allow small -250ms clock skew between page postMessage and webRequest)
  const candidates = dataLayerEvents.filter((ev) => {
    if (ev.isConsentCommand) return false;
    const delta = hit.timestamp - ev.timestamp;
    return delta >= -250 && delta <= CORRELATION_WINDOW_MS;
  });

  if (candidates.length === 0) return null;

  // 2a. Prefer semantic event name match (most recent first)
  for (let i = candidates.length - 1; i >= 0; i--) {
    const ev = candidates[i];
    if (areEventsSemanticallyRelated(ev.eventName, hit.eventName)) {
      return { eventId: ev.id, reason: 'time_window' };
    }
  }

  // 2b. Prefer non-internal custom dataLayer events (most recent first)
  for (let i = candidates.length - 1; i >= 0; i--) {
    const ev = candidates[i];
    if (!INTERNAL_GTM_EVENTS.has(ev.eventName) && ev.eventName !== 'dataLayer.push') {
      return { eventId: ev.id, reason: 'time_window' };
    }
  }

  // 2c. Fall back to gtm.js / gtm.dom for pageview hits
  if (areEventsSemanticallyRelated('page_view', hit.eventName)) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].eventName === 'gtm.js' || candidates[i].eventName === 'gtm.dom') {
        return { eventId: candidates[i].id, reason: 'time_window' };
      }
    }
  }

  return null;
}

/**
 * Re-links all hits and dataLayer events bidirectionally.
 */
export function correlateSession(
  dataLayerEvents: DataLayerEvent[],
  hits: ParsedHit[],
): void {
  const eventMap = new Map<string, DataLayerEvent>();
  for (const ev of dataLayerEvents) {
    ev.correlatedHitIds = [];
    eventMap.set(ev.id, ev);
  }

  for (const hit of hits) {
    const match = findCorrelatedEventForHit(hit, dataLayerEvents);
    if (match) {
      hit.correlatedEventId = match.eventId;
      hit.correlationReason = match.reason;
      const ev = eventMap.get(match.eventId);
      if (ev && !ev.correlatedHitIds.includes(hit.id)) {
        ev.correlatedHitIds.push(hit.id);
      }
    } else {
      hit.correlatedEventId = undefined;
      hit.correlationReason = undefined;
    }
  }
}
