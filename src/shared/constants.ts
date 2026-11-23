import type { ConsentSnapshot, VendorId } from './types';

export const CORRELATION_WINDOW_MS = 3000;
export const DUPLICATE_WINDOW_MS = 2000;
export const EVENT_WITHOUT_HIT_WINDOW_MS = 5000;
export const CLICK_ID_GRACE_WINDOW_MS = 3000;

export const CONVERSION_EVENT_NAMES = new Set([
  'generate_lead',
  'form_submit',
  'purchase',
  'sign_up',
  'signup',
  'lead',
  'conversion',
  'book_demo',
  'demo_request',
  'request_demo',
  'schedule_demo',
  'contact_submit',
  'submit_form',
  'begin_checkout',
  'complete_registration',
  'subscribe',
  'trial_start',
  'start_trial',
]);

export const META_CONVERSION_EVENTS = new Set([
  'lead',
  'purchase',
  'completeregistration',
  'submitapplication',
  'schedule',
  'contact',
  'starttrial',
  'subscribe',
]);

export const GA4_CONVERSION_EVENTS = new Set([
  'generate_lead',
  'purchase',
  'form_submit',
  'sign_up',
  'book_demo',
  'request_demo',
]);

export const SEMANTIC_EVENT_EQUIVALENTS: Record<string, string[]> = {
  page_view: ['page_view', 'pageview', 'page view', 'insight hit'],
  generate_lead: ['generate_lead', 'lead', 'form_submit', 'form submission', 'conversion', 'submitform'],
  form_submit: ['form_submit', 'form submission', 'generate_lead', 'lead', 'conversion'],
  purchase: ['purchase', 'conversion', 'completepayment'],
  sign_up: ['sign_up', 'completeregistration', 'signup', 'conversion'],
  add_to_cart: ['add_to_cart', 'addtocart'],
  begin_checkout: ['begin_checkout', 'initiatecheckout'],
  view_item: ['view_item', 'viewcontent'],
};

export interface MarketingCookieDef {
  pattern: RegExp;
  vendorId?: VendorId;
  vendorName: string;
  requiresConsent: 'ad_storage' | 'analytics_storage';
  description: string;
}

export const MARKETING_COOKIES: MarketingCookieDef[] = [
  {
    pattern: /^_ga($|_)/,
    vendorId: 'ga4',
    vendorName: 'GA4',
    requiresConsent: 'analytics_storage',
    description: 'Client ID e estado de sessão do Google Analytics 4',
  },
  {
    pattern: /^_gid$/,
    vendorId: 'ga4',
    vendorName: 'GA4',
    requiresConsent: 'analytics_storage',
    description: 'Identificador diário de usuário do Google Analytics',
  },
  {
    pattern: /^_gcl_(aw|dc|gb|gs|au)$/,
    vendorId: 'google_ads',
    vendorName: 'Google Ads',
    requiresConsent: 'ad_storage',
    description: 'Cookie de atribuição de clique (gclid) do Google Ads',
  },
  {
    pattern: /^_fbp$/,
    vendorId: 'meta_pixel',
    vendorName: 'Meta Pixel',
    requiresConsent: 'ad_storage',
    description: 'Identificador de navegador do Meta Pixel',
  },
  {
    pattern: /^_fbc$/,
    vendorId: 'meta_pixel',
    vendorName: 'Meta Pixel',
    requiresConsent: 'ad_storage',
    description: 'Cookie de clique (fbclid) do Meta Pixel',
  },
  {
    pattern: /^hubspotutk$/,
    vendorId: 'hubspot',
    vendorName: 'HubSpot',
    requiresConsent: 'analytics_storage',
    description: 'Identificador de visitante do HubSpot',
  },
  {
    pattern: /^__hs(sc|rc|tc)$/,
    vendorId: 'hubspot',
    vendorName: 'HubSpot',
    requiresConsent: 'analytics_storage',
    description: 'Cookie de sessão/rastreamento do HubSpot',
  },
  {
    pattern: /^_clck$/,
    vendorId: 'clarity',
    vendorName: 'Microsoft Clarity',
    requiresConsent: 'analytics_storage',
    description: 'Identificador de usuário do Microsoft Clarity',
  },
  {
    pattern: /^_clsk$/,
    vendorId: 'clarity',
    vendorName: 'Microsoft Clarity',
    requiresConsent: 'analytics_storage',
    description: 'Cookie de sessão do Microsoft Clarity',
  },
  {
    pattern: /^(li_fat_id|li_sugr|bcookie)$/,
    vendorId: 'linkedin',
    vendorName: 'LinkedIn Insight',
    requiresConsent: 'ad_storage',
    description: 'Cookie de atribuição do LinkedIn Ads',
  },
  {
    pattern: /^(_ttp|ttclid)$/,
    vendorId: 'tiktok',
    vendorName: 'TikTok Pixel',
    requiresConsent: 'ad_storage',
    description: 'Cookie de atribuição do TikTok Pixel',
  },
  {
    pattern: /^_rdt_uuid$/,
    vendorId: 'reddit',
    vendorName: 'Reddit Pixel',
    requiresConsent: 'ad_storage',
    description: 'Identificador do Reddit Pixel',
  },
];

export const VENDOR_DISPLAY_NAMES: Record<VendorId, string> = {
  gtm: 'GTM',
  ga4: 'GA4',
  google_ads: 'Google Ads',
  meta_pixel: 'Meta Pixel',
  linkedin: 'LinkedIn Insight',
  hubspot: 'HubSpot',
  clarity: 'Microsoft Clarity',
  tiktok: 'TikTok Pixel',
  reddit: 'Reddit Pixel',
  x_pixel: 'X Pixel',
  mixpanel: 'Mixpanel',
};

export const ADS_VENDORS = new Set<VendorId>([
  'google_ads',
  'meta_pixel',
  'linkedin',
  'tiktok',
  'reddit',
  'x_pixel',
]);

export const ANALYTICS_VENDORS = new Set<VendorId>([
  'ga4',
  'clarity',
  'hubspot',
  'mixpanel',
]);

export function createInitialConsent(timestamp = Date.now()): ConsentSnapshot {
  return {
    ad_storage: 'unknown',
    analytics_storage: 'unknown',
    ad_user_data: 'unknown',
    ad_personalization: 'unknown',
    source: 'initial',
    updatedAt: timestamp,
  };
}

export function matchMarketingCookie(name: string): MarketingCookieDef | null {
  for (const def of MARKETING_COOKIES) {
    if (def.pattern.test(name)) {
      return def;
    }
  }
  return null;
}
