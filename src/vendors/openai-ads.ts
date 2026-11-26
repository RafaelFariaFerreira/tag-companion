import type { VendorModule, VendorMatch } from './types';
import type { DecodedParam, ParsedHit, RawNetworkRequest } from '@/shared/types';
import {
  buildDecodedParam,
  detectTagOrigin,
  extractQueryParams,
  flattenObject,
  getEndpointPath,
  inferHitStatus,
  parseJsonSafe,
  safeParseUrl,
} from './utils';

/**
 * OpenAI Ads Measurement Pixel (oaiq), the conversion pixel for ChatGPT ads.
 *
 * - Script: https://bzrcdn.openai.com/sdk/oaiq.min.js (global `oaiq`)
 * - JS pixel: POST https://bzr.openai.com/v1/sdk/events?pid=&st=oaiq-web&sv=&t=&ec=
 *   with a text/plain JSON body {obref, oppref, user, client_hints, events: [...]}; one request can carry several events.
 * - Image tag (no JS): GET the same path with pid, event, custom_event_name, event_id, oppref and data[<field>].
 * Amounts are integers in minor units (2599 = 25.99).
 */
const VENDOR_ID = 'openai_ads' as const;
const VENDOR_NAME = 'OpenAI Ads';

const OPENAI_LABELS: Record<string, string> = {
  pid: 'ID do pixel',
  st: 'Tipo do SDK',
  sv: 'Versão do SDK',
  t: 'Horário do envio',
  ec: 'Eventos no envio',
  event: 'Evento',
  type: 'Evento',
  id: 'ID do evento (deduplicação)',
  event_id: 'ID do evento (deduplicação)',
  custom_event_name: 'Nome do evento personalizado',
  timestamp_ms: 'Horário do evento',
  source_url: 'URL da página',
  referrer_url: 'Referrer',
  opt_out: 'Opt-out',
  test_session_id: 'Sessão de teste',
  oppref: 'Clique do anúncio (oppref)',
  obref: 'ID do navegador (obref)',
  'data.type': 'Tipo dos dados',
  'data.amount': 'Valor (centavos)',
  'data.currency': 'Moeda',
  'data.plan_id': 'ID do plano',
  'data.contents': 'Itens',
  'user.email_sha256': 'E-mail (SHA-256)',
  'user.phone_number_sha256': 'Telefone (SHA-256)',
  'user.external_id_sha256': 'ID externo (SHA-256)',
  'user.first_name_sha256': 'Nome (SHA-256)',
  'user.last_name_sha256': 'Sobrenome (SHA-256)',
  'user.country': 'País',
  'user.region': 'Estado / região',
  'user.city': 'Cidade',
  'user.postal_code': 'CEP',
};

/** Events the SDK sends on its own, not set up by the advertiser. */
const SDK_EVENT_NAMES: Record<string, string> = {
  'openai::sdk_init': 'sdk_init',
  'oai::diagnostic': 'diagnostic',
};

function isOpenAiHost(host: string, sub: 'bzr' | 'bzrcdn'): boolean {
  return host.toLowerCase() === `${sub}.openai.com`;
}

function classifyGroup(key: string): DecodedParam['group'] {
  if (['pid', 'type', 'event', 'custom_event_name', 'id', 'event_id'].includes(key)) return 'core';
  if (key === 'oppref' || key === 'obref' || key.startsWith('user.')) return 'user';
  if (key.startsWith('data.')) return 'ecommerce';
  if (key === 'source_url' || key === 'referrer_url') return 'page';
  return 'other';
}

function stringifyValues(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[`${prefix}${k}`] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/** Image-tag query: data[amount]=… becomes data.amount, the rest stays as is. */
function normalizeImageTagParams(query: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    const m = /^data\[([^\]]+)\]$/.exec(k);
    out[m ? `data.${m[1]}` : k] = v;
  }
  return out;
}

export const openAiAdsVendor: VendorModule = {
  id: VENDOR_ID,
  name: VENDOR_NAME,
  category: 'ads',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;
    const host = parsed.hostname;
    const path = parsed.pathname;

    if (isOpenAiHost(host, 'bzrcdn') && /\/sdk\/oaiq(\.min)?\.js$/i.test(path)) {
      return { vendorId: VENDOR_ID, vendorName: VENDOR_NAME, kind: 'script', scriptName: 'oaiq.min.js' };
    }

    if (isOpenAiHost(host, 'bzr') && /^\/v1\/sdk\/events\/?$/i.test(path) && resourceType !== 'script') {
      return {
        vendorId: VENDOR_ID,
        vendorName: VENDOR_NAME,
        kind: 'hit',
        accountId: parsed.searchParams.get('pid') ?? undefined,
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];
    const query = extractQueryParams(parsed);
    const accountId = query.pid || undefined;

    const base = {
      requestId: request.requestId,
      vendorId: VENDOR_ID,
      vendorName: VENDOR_NAME,
      category: 'ads' as const,
      accountId,
      endpoint: getEndpointPath(request.url),
      url: request.url,
      method: request.method,
      status: inferHitStatus(request),
      statusCode: request.statusCode,
      error: request.error,
      timestamp: request.timestamp,
      origin: detectTagOrigin(request, false),
      source: request.source,
    };

    const build = (index: number, rawParams: Record<string, string>): ParsedHit => {
      const type = rawParams.type || rawParams.event || 'event';
      const eventName =
        type === 'custom' && rawParams.custom_event_name
          ? rawParams.custom_event_name
          : SDK_EVENT_NAMES[type] ?? type;
      return {
        ...base,
        id: `${request.requestId}#${index}`,
        eventName,
        eventId: rawParams.id || rawParams.event_id || undefined,
        pageUrl: request.pageUrl || rawParams.source_url || '',
        params: Object.entries(rawParams).map(([k, v]) =>
          buildDecodedParam(k, v, openAiAdsVendor.label, classifyGroup(k)),
        ),
        rawParams,
      };
    };

    const json = request.requestBody ? parseJsonSafe(request.requestBody) : null;
    const events = json && Array.isArray(json.events) ? (json.events as unknown[]) : null;

    // Image tag (GET, one event in the query string)
    if (!events) {
      if (!query.event) return [];
      return [build(0, normalizeImageTagParams(query))];
    }

    // JS pixel: shared envelope + one hit per event
    const envelope: Record<string, string> = { ...query };
    if (json) {
      for (const key of ['obref', 'oppref'] as const) {
        if (typeof json[key] === 'string') envelope[key] = json[key] as string;
      }
      if (json.user && typeof json.user === 'object') {
        Object.assign(envelope, stringifyValues(json.user as Record<string, unknown>, 'user.'));
      }
      if (json.client_hints && typeof json.client_hints === 'object') {
        Object.assign(envelope, flattenObject(json.client_hints as Record<string, unknown>, 'client_hints'));
      }
    }

    return events
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((event, index) => {
        const { data, ...rest } = event;
        const rawParams: Record<string, string> = { ...envelope, ...stringifyValues(rest) };
        if (data && typeof data === 'object') {
          Object.assign(rawParams, stringifyValues(data as Record<string, unknown>, 'data.'));
        }
        return build(index, rawParams);
      });
  },

  label(param: string): string {
    if (OPENAI_LABELS[param]) return OPENAI_LABELS[param];
    if (param.startsWith('client_hints.')) return `Client hint: ${param.slice(13)}`;
    if (param.startsWith('data.')) return `Dados: ${param.slice(5)}`;
    return param;
  },
};
