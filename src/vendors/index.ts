import type { VendorModule, VendorMatch } from './types';
import type { ParsedHit, RawNetworkRequest, VendorId } from '@/shared/types';
import { gtmVendor } from './gtm';
import { ga4Vendor } from './ga4';
import { googleAdsVendor } from './google-ads';
import { metaPixelVendor } from './meta-pixel';
import { linkedinVendor } from './linkedin';
import { hubspotVendor } from './hubspot';
import { clarityVendor } from './clarity';
import { openAiAdsVendor } from './openai-ads';
import {
  mixpanelVendor,
  redditVendor,
  tiktokVendor,
  xPixelVendor,
} from './phase2';

export const VENDOR_MODULES: VendorModule[] = [
  gtmVendor,
  googleAdsVendor,
  ga4Vendor,
  metaPixelVendor,
  linkedinVendor,
  hubspotVendor,
  clarityVendor,
  tiktokVendor,
  redditVendor,
  xPixelVendor,
  mixpanelVendor,
  openAiAdsVendor,
];

const VENDOR_BY_ID = new Map<VendorId, VendorModule>(
  VENDOR_MODULES.map((m) => [m.id, m]),
);

export function getVendorModule(id: VendorId): VendorModule | undefined {
  return VENDOR_BY_ID.get(id);
}

export function matchVendorRequest(
  url: string,
  resourceType?: string,
): { module: VendorModule; match: VendorMatch } | null {
  for (const mod of VENDOR_MODULES) {
    const match = mod.match(url, resourceType);
    if (match) {
      return { module: mod, match };
    }
  }
  return null;
}

export function parseVendorRequest(request: RawNetworkRequest): {
  match: VendorMatch;
  hits: ParsedHit[];
} | null {
  const matched = matchVendorRequest(request.url, request.resourceType);
  if (!matched) return null;
  if (matched.match.kind === 'script') {
    return { match: matched.match, hits: [] };
  }
  const hits = matched.module.parse(request);
  return { match: matched.match, hits };
}

export function labelVendorParam(vendorId: VendorId, param: string): string {
  return VENDOR_BY_ID.get(vendorId)?.label(param) ?? param;
}

export type { VendorModule, VendorMatch };
