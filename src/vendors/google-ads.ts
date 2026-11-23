import type { VendorModule, VendorMatch } from './types';
import type { DecodedParam, ParsedHit, RawNetworkRequest } from '@/shared/types';
import {
  buildDecodedParam,
  detectTagOrigin,
  extractQueryParams,
  getEndpointPath,
  inferHitStatus,
  parseFormEncoded,
  safeParseUrl,
} from './utils';

const ADS_LABELS: Record<string, string> = {
  aw_id: 'ID da conta Google Ads',
  label: 'Rótulo de conversão',
  value: 'Valor da conversão',
  currency_code: 'Moeda',
  gclid: 'Google Click ID (gclid)',
  gbraid: 'Google Braid ID (gbraid)',
  wbraid: 'Web Braid ID (wbraid)',
  oid: 'ID da transação',
  gcs: 'Consentimento (gcs)',
  gcd: 'Consent Mode v2 (gcd)',
  url: 'URL da página',
  ref: 'Referenciador',
  em: 'E-mail (Enhanced Conversions)',
  gtm: 'Hash do container GTM',
  en: 'Evento',
};

function extractAwIdFromPath(pathname: string): string | undefined {
  const match = /\/(?:1p-)?conversion\/(\d+)/i.exec(pathname);
  if (match) return `AW-${match[1]}`;
  return undefined;
}

export const googleAdsVendor: VendorModule = {
  id: 'google_ads',
  name: 'Google Ads',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // Script: gtag/js?id=AW-... or conversion_async.js
    if (
      /\/gtag\/js$/i.test(path) &&
      /^AW-/i.test(parsed.searchParams.get('id') ?? '')
    ) {
      return {
        vendorId: 'google_ads',
        vendorName: 'Google Ads',
        kind: 'script',
        scriptName: 'gtag/js',
        accountId: parsed.searchParams.get('id') ?? undefined,
      };
    }

    if (
      /googleadservices\.com$/i.test(host) &&
      /\/pagead\/conversion(_async)?\.js$/i.test(path)
    ) {
      return {
        vendorId: 'google_ads',
        vendorName: 'Google Ads',
        kind: 'script',
        scriptName: 'conversion_async.js',
      };
    }

    // Conversion hit endpoints
    const isConversionEndpoint =
      (/(^|\.)googleadservices\.com$/i.test(host) &&
        /\/pagead\/conversion\//i.test(path)) ||
      (/(^|\.)google(\.com)?(\.[a-z]{2})?$/i.test(host) &&
        /\/pagead\/(1p-)?conversion\//i.test(path)) ||
      (/(^|\.)doubleclick\.net$/i.test(host) &&
        /\/pagead\/viewthroughconversion\//i.test(path));

    if (isConversionEndpoint && resourceType !== 'script') {
      return {
        vendorId: 'google_ads',
        vendorName: 'Google Ads',
        kind: 'hit',
        accountId: extractAwIdFromPath(path),
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const queryParams = extractQueryParams(parsed);
    const bodyParams = request.requestBody ? parseFormEncoded(request.requestBody) : {};
    const rawParams: Record<string, string> = { ...queryParams, ...bodyParams };

    const accountId = extractAwIdFromPath(parsed.pathname) || rawParams.aw_id;
    if (accountId && !rawParams.aw_id) {
      rawParams.aw_id = accountId;
    }

    // Extract gclid from query or from page URL param
    if (!rawParams.gclid && rawParams.url) {
      const pageParsed = safeParseUrl(rawParams.url);
      const gclid = pageParsed?.searchParams.get('gclid');
      if (gclid) rawParams.gclid = gclid;
    }

    const eventName = rawParams.label
      ? `conversion (${rawParams.label})`
      : rawParams.en || 'conversion';

    const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) => {
      let group: DecodedParam['group'] = 'other';
      if (k === 'aw_id' || k === 'label' || k === 'gclid' || k === 'oid') group = 'core';
      else if (k === 'value' || k === 'currency_code') group = 'ecommerce';
      else if (k === 'gcs' || k === 'gcd') group = 'consent';
      else if (k === 'url' || k === 'ref') group = 'page';
      else if (k === 'em') group = 'user';
      return buildDecodedParam(k, v, googleAdsVendor.label, group);
    });

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'google_ads',
        vendorName: 'Google Ads',
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
        pageUrl: request.pageUrl || rawParams.url || '',
        origin: detectTagOrigin(request, false),
        params,
        rawParams,
        eventId: rawParams.oid || undefined,
        gcs: rawParams.gcs || undefined,
        gcd: rawParams.gcd || undefined,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    return ADS_LABELS[param] ?? param;
  },
};
