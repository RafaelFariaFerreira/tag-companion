import type { VendorModule, VendorMatch } from './types';
import type { DecodedParam, ParsedHit, RawNetworkRequest } from '@/shared/types';
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

const HUBSPOT_LABELS: Record<string, string> = {
  a: 'Portal ID (HubSpot)',
  portalId: 'Portal ID (HubSpot)',
  formId: 'ID do formulário',
  hutk: 'HubSpot User Token (hutk)',
  vi: 'Visitor ID (hutk)',
  pu: 'URL da página',
  k: 'Tipo de evento',
  n: 'Nome do evento',
  r: 'Referenciador',
  t: 'Título da página',
  'context.hutk': 'HubSpot User Token (hutk)',
  'context.pageUri': 'URL da página',
  'context.pageName': 'Título da página',
};

function extractHubSpotPortalAndForm(pathname: string): {
  portalId?: string;
  formId?: string;
} {
  // e.g. /submissions/v3/integration/submit/<portalId>/<formId>
  // or /uploads/form/v2/<portalId>/<formId>
  const formMatch = /\/(?:submit|v2|v3)\/(\d+)\/([a-f0-9-]{8,})/i.exec(pathname);
  if (formMatch) {
    return { portalId: formMatch[1], formId: formMatch[2] };
  }
  const scriptMatch = /\/(\d+)\.js$/i.exec(pathname);
  if (scriptMatch) {
    return { portalId: scriptMatch[1] };
  }
  return {};
}

export const hubspotVendor: VendorModule = {
  id: 'hubspot',
  name: 'HubSpot',
  category: 'crm',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // Scripts: js.hs-scripts.com, js-eu1.hs-scripts.com, js.hs-analytics.net, js.hsforms.net
    if (
      /(^|\.)hs-scripts\.com$/i.test(host) ||
      /(^|\.)hs-analytics\.net$/i.test(host) ||
      /(^|\.)hsforms\.net$/i.test(host)
    ) {
      const { portalId } = extractHubSpotPortalAndForm(path);
      const scriptName = host.includes('hsforms')
        ? 'hsforms.net'
        : host.includes('hs-analytics')
          ? 'hs-analytics.net'
          : 'hs-scripts.com';
      return {
        vendorId: 'hubspot',
        vendorName: 'HubSpot',
        kind: 'script',
        scriptName,
        accountId: portalId,
      };
    }

    // Hits: track.hubspot.com, track-eu1.hubspot.com, forms.hubspot.com, api.hsforms.com
    const isTrack = /(^|\.)track(-eu1)?\.hubspot\.com$/i.test(host);
    const isForms =
      /(^|\.)forms(-eu1)?\.hubspot\.com$/i.test(host) ||
      /(^|\.)api(-eu1)?\.hsforms\.com$/i.test(host);

    if ((isTrack || isForms) && resourceType !== 'script') {
      const { portalId } = extractHubSpotPortalAndForm(path);
      return {
        vendorId: 'hubspot',
        vendorName: 'HubSpot',
        kind: 'hit',
        accountId: portalId || parsed.searchParams.get('a') || undefined,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const host = parsed.hostname.toLowerCase();
    const isFormSubmission =
      host.includes('forms.hubspot.com') || host.includes('hsforms.com');

    const queryParams = extractQueryParams(parsed);
    const pathIds = extractHubSpotPortalAndForm(parsed.pathname);

    let bodyParams: Record<string, string> = {};
    if (request.requestBody) {
      const jsonBody = parseJsonSafe(request.requestBody);
      if (jsonBody) {
        bodyParams = flattenObject(jsonBody);
        // Handle HubSpot v3 `fields: [{ name, value }]`
        if (Array.isArray(jsonBody.fields)) {
          for (const field of jsonBody.fields) {
            if (
              field &&
              typeof field === 'object' &&
              'name' in field &&
              'value' in field
            ) {
              const f = field as { name: string; value: unknown };
              bodyParams[`field.${f.name}`] = String(f.value ?? '');
            }
          }
        }
      } else {
        bodyParams = parseFormEncoded(request.requestBody);
      }
    }

    const rawParams: Record<string, string> = { ...queryParams, ...bodyParams };
    const portalId = pathIds.portalId || rawParams.a || rawParams.portalId;
    const formId = pathIds.formId || rawParams.formId;
    if (portalId && !rawParams.portalId) rawParams.portalId = portalId;
    if (formId && !rawParams.formId) rawParams.formId = formId;

    // Normalize hutk
    const hutk = rawParams.hutk || rawParams.vi || rawParams['context.hutk'];
    if (hutk && !rawParams.hutk) rawParams.hutk = hutk;

    let eventName = 'PageView';
    if (isFormSubmission) {
      eventName = 'Form Submission';
    } else if (rawParams.n) {
      eventName = rawParams.n;
    } else if (rawParams.k === '3') {
      eventName = 'Custom Event';
    } else if (rawParams.k === '1') {
      eventName = 'PageView';
    }

    const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) => {
      let group: DecodedParam['group'] = 'other';
      if (k === 'portalId' || k === 'a' || k === 'formId') group = 'core';
      else if (k === 'hutk' || k === 'vi' || k === 'context.hutk') group = 'user';
      else if (k === 'pu' || k === 'r' || k === 't' || k === 'context.pageUri') group = 'page';
      else if (k.startsWith('field.') || k === 'n') group = 'event';
      return buildDecodedParam(k, v, hubspotVendor.label, group);
    });

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'hubspot',
        vendorName: 'HubSpot',
        category: 'crm',
        accountId: portalId,
        eventName,
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || rawParams.pu || rawParams['context.pageUri'] || '',
        origin: detectTagOrigin(request, false),
        params,
        rawParams,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    if (HUBSPOT_LABELS[param]) return HUBSPOT_LABELS[param];
    if (param.startsWith('field.')) return `Campo do formulário: ${param.slice(6)}`;
    return param;
  },
};
