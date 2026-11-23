import type { VendorModule, VendorMatch } from './types';
import type { ParsedHit, RawNetworkRequest } from '@/shared/types';
import { safeParseUrl } from './utils';

const LABELS: Record<string, string> = {
  id: 'ID do container GTM',
  l: 'Nome do dataLayer',
  gtm_auth: 'Token de ambiente GTM',
  gtm_preview: 'ID do ambiente Preview',
};

export const gtmVendor: VendorModule = {
  id: 'gtm',
  name: 'GTM',
  category: 'tag_manager',

  match(url: string, resourceType?: string): VendorMatch | null {
    const parsed = safeParseUrl(url);
    if (!parsed) return null;

    const isOfficialHost = /(^|\.)googletagmanager\.com$/i.test(parsed.hostname);
    const id = parsed.searchParams.get('id') ?? undefined;
    const isGtmPath = /\/gtm\.js$/i.test(parsed.pathname);

    if (!isGtmPath) return null;
    if (!isOfficialHost && !(id && /^GTM-/i.test(id))) return null;
    if (resourceType && resourceType !== 'script' && resourceType !== 'other') {
      return null;
    }

    return {
      vendorId: 'gtm',
      vendorName: 'GTM',
      kind: 'script',
      scriptName: 'gtm.js',
      accountId: id,
      isServerSide: !isOfficialHost,
    };
  },

  parse(_request: RawNetworkRequest): ParsedHit[] {
    // GTM is a container loader (script), not a data-collection hit
    return [];
  },

  label(param: string): string {
    return LABELS[param] ?? param;
  },
};
