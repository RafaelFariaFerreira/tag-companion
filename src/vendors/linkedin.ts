import type { VendorModule, VendorMatch } from './types';
import type { DecodedParam, ParsedHit, RawNetworkRequest } from '@/shared/types';
import {
  buildDecodedParam,
  detectTagOrigin,
  extractQueryParams,
  getEndpointPath,
  inferHitStatus,
  safeParseUrl,
} from './utils';

const LINKEDIN_LABELS: Record<string, string> = {
  pid: 'Partner ID (LinkedIn)',
  conversionId: 'ID da conversão',
  fmt: 'Formato da resposta',
  url: 'URL da página',
  li_fat_id: 'LinkedIn First-Party Ad Tracking ID',
  tm: 'Tag Manager',
  v: 'Versão',
};

export const linkedinVendor: VendorModule = {
  id: 'linkedin',
  name: 'LinkedIn Insight',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // Script: snap.licdn.com/li.lms-analytics/insight.min.js
    if (/(^|\.)snap\.licdn\.com$/i.test(host) && /insight(\.min)?\.js$/i.test(path)) {
      return {
        vendorId: 'linkedin',
        vendorName: 'LinkedIn Insight',
        kind: 'script',
        scriptName: 'insight.min.js',
      };
    }

    // Hit: px.ads.linkedin.com
    if (/(^|\.)px\.ads\.linkedin\.com$/i.test(host) && resourceType !== 'script') {
      return {
        vendorId: 'linkedin',
        vendorName: 'LinkedIn Insight',
        kind: 'hit',
        accountId: parsed.searchParams.get('pid') ?? undefined,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const rawParams = extractQueryParams(parsed);
    const accountId = rawParams.pid || undefined;
    const conversionId = rawParams.conversionId || rawParams.conversion_id;
    const eventName = conversionId ? `Conversion (${conversionId})` : 'PageView';

    const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) => {
      let group: DecodedParam['group'] = 'other';
      if (k === 'pid' || k === 'conversionId') group = 'core';
      else if (k === 'url') group = 'page';
      else if (k === 'li_fat_id') group = 'user';
      return buildDecodedParam(k, v, linkedinVendor.label, group);
    });

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'linkedin',
        vendorName: 'LinkedIn Insight',
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
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    return LINKEDIN_LABELS[param] ?? param;
  },
};
