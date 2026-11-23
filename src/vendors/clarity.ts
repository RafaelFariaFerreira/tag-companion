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

const CLARITY_LABELS: Record<string, string> = {
  projectId: 'ID do projeto Clarity',
  p: 'ID do projeto Clarity',
  'e.p': 'ID do projeto Clarity',
  s: 'ID da sessão',
  u: 'ID do usuário',
  v: 'Versão do script',
};

function extractProjectIdFromTagPath(pathname: string): string | undefined {
  const match = /\/tag\/([a-z0-9_-]+)/i.exec(pathname);
  return match ? match[1] : undefined;
}

export const clarityVendor: VendorModule = {
  id: 'clarity',
  name: 'Microsoft Clarity',
  category: 'session_replay',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (!/(^|\.)clarity\.ms$/i.test(host)) return null;

    // Script: clarity.ms/tag/<projectId> or clarity.ms/s/<ver>/clarity.js
    if (/^\/tag\//i.test(path) || /clarity\.js$/i.test(path)) {
      return {
        vendorId: 'clarity',
        vendorName: 'Microsoft Clarity',
        kind: 'script',
        scriptName: 'clarity.ms/tag',
        accountId: extractProjectIdFromTagPath(path),
      };
    }

    // Hit: clarity.ms/collect
    if (/\/collect$/i.test(path) && resourceType !== 'script') {
      return {
        vendorId: 'clarity',
        vendorName: 'Microsoft Clarity',
        kind: 'hit',
      };
    }

    return null;
  },

  parse(request: RawNetworkRequest): ParsedHit[] {
    const parsed = safeParseUrl(request.url);
    if (!parsed) return [];

    const queryParams = extractQueryParams(parsed);
    let bodyParams: Record<string, string> = {};
    let projectId: string | undefined = queryParams.p || queryParams.projectId;

    if (request.requestBody) {
      const json = parseJsonSafe(request.requestBody);
      if (json) {
        bodyParams = flattenObject(json);
        // Clarity envelope `e` is often an array: [version, sequence, start, projectId, userId, sessionId, ...]
        if (Array.isArray(json.e) && typeof json.e[3] === 'string') {
          projectId = json.e[3];
          bodyParams.projectId = projectId;
        }
        if (typeof json.p === 'string') {
          projectId = json.p;
          bodyParams.projectId = projectId;
        }
      }
    }

    const rawParams: Record<string, string> = { ...queryParams, ...bodyParams };
    if (projectId) rawParams.projectId = projectId;

    const params: DecodedParam[] = Object.entries(rawParams).map(([k, v]) => {
      const group: DecodedParam['group'] =
        k === 'projectId' || k === 'p' ? 'core' : 'other';
      return buildDecodedParam(k, v, clarityVendor.label, group);
    });

    return [
      {
        id: `${request.requestId}#0`,
        requestId: request.requestId,
        vendorId: 'clarity',
        vendorName: 'Microsoft Clarity',
        category: 'session_replay',
        accountId: projectId,
        eventName: 'collect',
        endpoint: getEndpointPath(request.url),
        url: request.url,
        method: request.method,
        status: inferHitStatus(request),
        statusCode: request.statusCode,
        error: request.error,
        timestamp: request.timestamp,
        pageUrl: request.pageUrl || '',
        origin: detectTagOrigin(request, false),
        params,
        rawParams,
        source: request.source,
      },
    ];
  },

  label(param: string): string {
    return CLARITY_LABELS[param] ?? param;
  },
};
