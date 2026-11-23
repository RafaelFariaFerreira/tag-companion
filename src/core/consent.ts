import type { ConsentSnapshot, ConsentValue } from '@/shared/types';
import { createInitialConsent } from '@/shared/constants';

export const CONSENT_KEYS = [
  'ad_storage',
  'analytics_storage',
  'ad_user_data',
  'ad_personalization',
] as const;

export type ConsentKey = (typeof CONSENT_KEYS)[number];

/**
 * Decodes Google's `gcs` parameter (e.g. G100, G101, G110, G111).
 * Position 2 -> ad_storage (1 = granted, 0 = denied)
 * Position 3 -> analytics_storage (1 = granted, 0 = denied)
 */
export function decodeGcs(gcs: string): Partial<Record<ConsentKey, ConsentValue>> | null {
  const trimmed = gcs.trim();
  const match = /^G1([01-])([01-])$/i.exec(trimmed);
  if (!match) return null;

  const parseChar = (ch: string): ConsentValue => {
    if (ch === '1') return 'granted';
    if (ch === '0') return 'denied';
    return 'unknown';
  };

  return {
    ad_storage: parseChar(match[1]),
    analytics_storage: parseChar(match[2]),
  };
}

/**
 * Decodes Google Consent Mode v2 `gcd` parameter.
 * Typical format: `11p1p1p1p5` or `13r3r3r2r5` or `13t3t3t3t5`.
 * Letter codes between digits map to:
 * [ad_storage, analytics_storage, ad_user_data, ad_personalization]
 *
 * Google's Consent Mode v2 encoding table:
 * - Granted (default or updated to granted): r, t, v, l, e, g
 * - Denied (default or updated to denied): p, q, m, n, u, f
 * - Not set / unknown: l (sometimes default not set), o, k
 */
const GCD_GRANTED = new Set(['r', 't', 'v', 'e', 'g']);
const GCD_DENIED = new Set(['p', 'q', 'm', 'n', 'u', 'f']);

export function decodeGcd(gcd: string): Partial<Record<ConsentKey, ConsentValue>> | null {
  const trimmed = gcd.trim().toLowerCase();
  if (!trimmed.startsWith('1') || trimmed.length < 9) return null;

  // Extract letters in order after leading version prefix (2 digits like "11" or "13")
  const letters = trimmed.slice(2).match(/[a-z]/g);
  if (!letters || letters.length < 4) return null;

  const mapLetter = (letter: string): ConsentValue => {
    if (GCD_GRANTED.has(letter)) return 'granted';
    if (GCD_DENIED.has(letter)) return 'denied';
    return 'unknown';
  };

  return {
    ad_storage: mapLetter(letters[0]),
    analytics_storage: mapLetter(letters[1]),
    ad_user_data: mapLetter(letters[2]),
    ad_personalization: mapLetter(letters[3]),
  };
}

export function normalizeConsentValue(val: unknown): ConsentValue | undefined {
  if (val === 'granted' || val === true || val === 1 || val === '1') return 'granted';
  if (val === 'denied' || val === false || val === 0 || val === '0') return 'denied';
  return undefined;
}

export function parseConsentObject(
  obj: Record<string, unknown>,
): Partial<Record<ConsentKey, ConsentValue>> {
  const parsed: Partial<Record<ConsentKey, ConsentValue>> = {};
  for (const key of CONSENT_KEYS) {
    if (key in obj) {
      const normalized = normalizeConsentValue(obj[key]);
      if (normalized) {
        parsed[key] = normalized;
      }
    }
  }
  return parsed;
}

/**
 * Parses internal `window.google_tag_data.ics.entries` snapshot (complementary source per PRD).
 */
export function parseIcsEntries(
  entries: Record<string, { default?: boolean; update?: boolean; implicit?: boolean }>,
): Partial<Record<ConsentKey, ConsentValue>> {
  const parsed: Partial<Record<ConsentKey, ConsentValue>> = {};
  for (const key of CONSENT_KEYS) {
    const entry = entries[key];
    if (!entry) continue;
    if (typeof entry.update === 'boolean') {
      parsed[key] = entry.update ? 'granted' : 'denied';
    } else if (typeof entry.default === 'boolean') {
      parsed[key] = entry.default ? 'granted' : 'denied';
    }
  }
  return parsed;
}

export interface ConsentMergeResult {
  next: ConsentSnapshot;
  changedKeys: ConsentKey[];
}

export function mergeConsent(
  current: ConsentSnapshot,
  patch: Partial<Record<ConsentKey, ConsentValue>>,
  meta: {
    source: ConsentSnapshot['source'];
    timestamp: number;
    gcs?: string;
    gcd?: string;
  },
): ConsentMergeResult {
  const next: ConsentSnapshot = {
    ...current,
    source: meta.source,
    updatedAt: meta.timestamp,
    gcs: meta.gcs ?? current.gcs,
    gcd: meta.gcd ?? current.gcd,
  };

  const changedKeys: ConsentKey[] = [];

  for (const key of CONSENT_KEYS) {
    const incoming = patch[key];
    if (!incoming || incoming === 'unknown') continue;

    // `ics` is complementary: do not overwrite an explicit value already obtained from gcs/gcd/gtag
    if (
      meta.source === 'ics' &&
      current[key] !== 'unknown' &&
      (current.source === 'gcs' || current.source === 'gcd' || current.source === 'gtag')
    ) {
      continue;
    }

    if (current[key] !== incoming) {
      next[key] = incoming;
      changedKeys.push(key);
    }
  }

  return { next, changedKeys };
}

export function buildConsentFromHit(
  current: ConsentSnapshot,
  gcs: string | undefined,
  gcd: string | undefined,
  timestamp: number,
): { hitConsent: ConsentSnapshot; merged: ConsentMergeResult } {
  const gcsPatch = gcs ? decodeGcs(gcs) : null;
  const gcdPatch = gcd ? decodeGcd(gcd) : null;

  // Combine gcd (4 signals) and gcs (2 core signals, gcs takes precedence for ad_storage/analytics_storage)
  const combinedPatch: Partial<Record<ConsentKey, ConsentValue>> = {
    ...(gcdPatch ?? {}),
    ...(gcsPatch ?? {}),
  };

  const source: ConsentSnapshot['source'] = gcsPatch
    ? 'gcs'
    : gcdPatch
      ? 'gcd'
      : current.source;

  const hitConsent: ConsentSnapshot = {
    ...(current ?? createInitialConsent(timestamp)),
    ...Object.fromEntries(
      Object.entries(combinedPatch).filter(([, v]) => v && v !== 'unknown'),
    ),
    gcs: gcs ?? current.gcs,
    gcd: gcd ?? current.gcd,
    source,
    updatedAt: timestamp,
  };

  if (Object.keys(combinedPatch).length === 0) {
    return {
      hitConsent,
      merged: { next: current, changedKeys: [] },
    };
  }

  const merged = mergeConsent(current, combinedPatch, {
    source,
    timestamp,
    gcs,
    gcd,
  });

  return { hitConsent, merged };
}

export function formatConsentSummary(consent: ConsentSnapshot): string {
  return `ad_storage=${consent.ad_storage}, analytics_storage=${consent.analytics_storage}`;
}
