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

const GOOGLE_ANALYTICS_HOSTS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)analytics\.google\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
];

const GA4_LABELS: Record<string, string> = {
  tid: 'ID da propriedade (Measurement ID)',
  en: 'Evento',
  cid: 'Client ID',
  sid: 'ID da sessão',
  sct: 'Contagem de sessões',
  seg: 'Sessão engajada',
  gcs: 'Consentimento (gcs)',
  gcd: 'Consent Mode v2 (gcd)',
  dl: 'URL da página',
  dr: 'Referenciador',
  dt: 'Título da página',
  ul: 'Idioma',
  sr: 'Resolução de tela',
  v: 'Versão do protocolo',
  _et: 'Tempo de engajamento (ms)',
  _p: 'ID de página aleatório',
  _s: 'Sequência do hit',
  _fv: 'Primeira visita',
  _ss: 'Início de sessão',
  _ee: 'Evento externo',
  cu: 'Moeda',
  gtm: 'Hash do container GTM',
  tfd: 'Tempo desde o carregamento (ms)',
  npa: 'Anúncios não personalizados',
  dma: 'Conformidade DMA',
  ep: 'Parâmetro de evento',
  epn: 'Parâmetro numérico de evento',
  up: 'Propriedade de usuário',
  upn: 'Propriedade numérica de usuário',
};

function isOfficialGoogleHost(hostname: string): boolean {
  return GOOGLE_ANALYTICS_HOSTS.some((re) => re.test(hostname));
}

function classifyGroup(key: string): DecodedParam['group'] {
  if (key === 'tid' || key === 'en' || key === 'cid' || key === 'sid') return 'core';
  if (key === 'gcs' || key === 'gcd' || key === 'npa' || key === 'dma') return 'consent';
  if (key === 'dl' || key === 'dr' || key === 'dt') return 'page';
  if (key.startsWith('ep.') || key.startsWith('epn.')) return 'event';
  if (key.startsWith('up.') || key.startsWith('upn.')) return 'user';
  if (key === 'cu' || /^pr\d+/.test(key)) return 'ecommerce';
  return 'other';
}

export const ga4Vendor: VendorModule = {
  id: 'ga4',
  name: 'GA4',
  category: 'analytics',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const path = parsed.pathname;

    // Script: gtag/js?id=G-...
    if (/\/gtag\/js$/i.test(path)) {
      const id = parsed.searchParams.get('id') ?? undefined;
      if (id && /^AW-/i.test(id)) {
        // Belongs to Google Ads module
        return null;
      }
      const isOfficial = isOfficialGoogleHost(parsed.hostname);
      if (!isOfficial && !(id && /^G-/i.test(id))) return null;
      return {
        vendorId: 'ga4',
        vendorName: 'GA4',
        kind: 'script',
        scriptName: 'gtag/js',
        accountId: id,
        isServerSide: !isOfficial,
      };
    }

    // Hit: /g/collect on ANY domain (supports sGTM custom domains per PRD)
    if (/\/g\/collect$/i.test(path)) {
      if (resourceType === 'script') return null;
      const tid = parsed.searchParams.get('tid') ?? undefined;
      const isOfficial = isOfficialGoogleHost(parsed.hostname);
      return {
        vendorId: 'ga4',
        vendorName: 'GA4',
        kind: 'hit',
        accountId: tid,
        isServerSide: !isOfficial,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const queryParams = extractQueryParams(parsed);
    const isServerSide = !isOfficialGoogleHost(parsed.hostname);
    const endpoint = getEndpointPath(request.url);
    const status = inferHitStatus(request);
    const origin = detectTagOrigin(request, isServerSide);

    // GA4 POST requests can batch multiple events separated by newlines in requestBody
    const bodyLines = (request.requestBody ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes('='));

    const eventPayloads: Record<string, string>[] =
      bodyLines.length > 0
        ? bodyLines.map((line) => ({ ...queryParams, ...parseFormEncoded(line) }))
        : [queryParams];

    return eventPayloads.map((rawParams, index) => {
      const accountId = rawParams.tid || undefined;
      const eventName = rawParams.en || 'collect';
      const eventId =
        rawParams['ep.event_id'] ||
        rawParams['epn.event_id'] ||
        rawParams['ep.eventId'] ||
        rawParams.eid ||
        undefined;
      const gcs = rawParams.gcs || undefined;
      const gcd = rawParams.gcd || undefined;

      const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) =>
        buildDecodedParam(k, v, ga4Vendor.label, classifyGroup(k)),
      );

      return {
        id: `${request.requestId}#${index}`,
        requestId: request.requestId,
        vendorId: 'ga4',
        vendorName: 'GA4',
        category: 'analytics',
        accountId,
        eventName,
        endpoint,
        url: request.url,
        method: request.method,
        status,
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || rawParams.dl || '',
        origin,
        params,
        rawParams,
        eventId,
        gcs,
        gcd,
        hasServerSideIndicator: isServerSide,
        source: request.source,
      };
    });
  },

  label(param: string): string {
    if (GA4_LABELS[param]) return GA4_LABELS[param];
    if (param.startsWith('ep.')) return `Evento: ${param.slice(3)}`;
    if (param.startsWith('epn.')) return `Evento (num): ${param.slice(4)}`;
    if (param.startsWith('up.')) return `Usuário: ${param.slice(3)}`;
    if (param.startsWith('upn.')) return `Usuário (num): ${param.slice(4)}`;
    if (/^pr\d+/.test(param)) return `Produto (${param})`;
    return param;
  },
};
