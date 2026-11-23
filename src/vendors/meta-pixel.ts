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

const META_LABELS: Record<string, string> = {
  id: 'ID do Meta Pixel',
  ev: 'Evento',
  eid: 'ID do evento (deduplicação CAPI)',
  dl: 'URL da página',
  rl: 'Referenciador',
  if: 'Dentro de iframe',
  ts: 'Timestamp',
  v: 'Versão do Pixel',
  fbp: 'Cookie _fbp',
  fbc: 'Cookie _fbc',
  noscript: 'Fallback noscript',
  sw: 'Largura da tela',
  sh: 'Altura da tela',
  'ud[em]': 'E-mail (Advanced Matching)',
  'ud[ph]': 'Telefone (Advanced Matching)',
  'ud[fn]': 'Nome (Advanced Matching)',
  'ud[ln]': 'Sobrenome (Advanced Matching)',
  'ud[external_id]': 'External ID',
};

export const metaPixelVendor: VendorModule = {
  id: 'meta_pixel',
  name: 'Meta Pixel',
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // Script: connect.facebook.net/*/fbevents.js or signals/config/<id>
    if (/(^|\.)connect\.facebook\.net$/i.test(host)) {
      if (/\/fbevents\.js$/i.test(path)) {
        return {
          vendorId: 'meta_pixel',
          vendorName: 'Meta Pixel',
          kind: 'script',
          scriptName: 'fbevents.js',
        };
      }
      const configMatch = /\/signals\/config\/(\d+)/i.exec(path);
      if (configMatch) {
        return {
          vendorId: 'meta_pixel',
          vendorName: 'Meta Pixel',
          kind: 'script',
          scriptName: 'fbevents.js',
          accountId: configMatch[1],
        };
      }
    }

    // Hit: facebook.com/tr
    if (/(^|\.)facebook\.com$/i.test(host) && /^\/tr\/?$/i.test(path)) {
      if (resourceType === 'script') return null;
      return {
        vendorId: 'meta_pixel',
        vendorName: 'Meta Pixel',
        kind: 'hit',
        accountId: parsed.searchParams.get('id') ?? undefined,
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

    const accountId = rawParams.id || undefined;
    const eventName = rawParams.ev || 'PageView';
    const eventId = rawParams.eid || rawParams['cd[event_id]'] || undefined;

    const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) => {
      let group: DecodedParam['group'] = 'other';
      if (k === 'id' || k === 'ev' || k === 'eid') group = 'core';
      else if (k.startsWith('cd[')) group = 'event';
      else if (k.startsWith('ud[') || k === 'fbp' || k === 'fbc') group = 'user';
      else if (k === 'dl' || k === 'rl') group = 'page';
      return buildDecodedParam(k, v, metaPixelVendor.label, group);
    });

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'meta_pixel',
        vendorName: 'Meta Pixel',
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
        pageUrl: request.pageUrl || rawParams.dl || '',
        origin: detectTagOrigin(request, false),
        params,
        rawParams,
        eventId,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    if (META_LABELS[param]) return META_LABELS[param];
    const cdMatch = /^cd\[(.+)\]$/.exec(param);
    if (cdMatch) return `Custom Data: ${cdMatch[1]}`;
    const udMatch = /^ud\[(.+)\]$/.exec(param);
    if (udMatch) return `User Data: ${udMatch[1]}`;
    return param;
  },
};
