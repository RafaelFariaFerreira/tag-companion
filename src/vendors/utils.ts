import type { DecodedParam, RawNetworkRequest, TagOrigin } from '@/shared/types';
import { isHashedValue, isSensitiveParamKey, containsPlainEmail, containsPlainPhone } from '@/core/pii';

export function safeParseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function extractQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }
  return params;
}

export function parseFormEncoded(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  const sp = new URLSearchParams(body);
  for (const [k, v] of sp.entries()) {
    params[k] = v;
  }
  return params;
}

export function parseJsonSafe(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  maxDepth = 4,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (maxDepth <= 0) return out;

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = String(v);
    } else if (Array.isArray(v)) {
      if (v.length <= 5 && v.every((x) => typeof x !== 'object')) {
        out[key] = v.join(', ');
      } else {
        out[key] = JSON.stringify(v).slice(0, 300);
      }
    } else if (typeof v === 'object') {
      Object.assign(out, flattenObject(v as Record<string, unknown>, key, maxDepth - 1));
    }
  }
  return out;
}

export function inferHitStatus(
  request: RawNetworkRequest,
): 'fired' | 'failed' | 'pending' {
  if (request.error) return 'failed';
  if (typeof request.statusCode === 'number') {
    if (request.statusCode >= 200 && request.statusCode < 400) return 'fired';
    if (request.statusCode >= 400 || request.statusCode === 0) return 'failed';
  }
  return 'pending';
}

export function detectTagOrigin(
  request: RawNetworkRequest,
  isServerSide = false,
): TagOrigin {
  if (isServerSide) return 'sgtm';

  const stack = request.initiatorStackUrls ?? [];
  const allSources = [...stack, request.initiator ?? ''].filter(Boolean);

  if (
    allSources.some(
      (u) =>
        /googletagmanager\.com\/gtm\.js/i.test(u) ||
        /\/gtm\.js(\?|$)/i.test(u),
    )
  ) {
    return 'gtm';
  }

  if (allSources.some((u) => /^https?:\/\//i.test(u))) {
    // If initiator is the page itself or a first-party script (not gtm.js)
    const parsedPage = request.pageUrl ? safeParseUrl(request.pageUrl) : null;
    if (parsedPage) {
      const hasFirstPartyScript = allSources.some((u) => {
        const parsed = safeParseUrl(u);
        return parsed && parsed.hostname === parsedPage.hostname;
      });
      if (hasFirstPartyScript) return 'hardcoded';
    }
    return 'hardcoded';
  }

  return 'unknown';
}

export function buildDecodedParam(
  key: string,
  value: string,
  labelFn: (param: string) => string,
  group: DecodedParam['group'] = 'other',
): DecodedParam {
  const isHashed = isHashedValue(value);
  const isPii =
    isSensitiveParamKey(key) ||
    (!isHashed && (containsPlainEmail(value) || containsPlainPhone(value)));

  return {
    key,
    label: labelFn(key),
    value,
    group,
    isPii,
    isHashed: isHashed && isSensitiveParamKey(key),
  };
}

export function getEndpointPath(rawUrl: string): string {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return rawUrl;
  return parsed.pathname || '/';
}
