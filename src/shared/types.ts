export type VendorId =
  | 'gtm'
  | 'ga4'
  | 'google_ads'
  | 'meta_pixel'
  | 'linkedin'
  | 'hubspot'
  | 'clarity'
  | 'tiktok'
  | 'reddit'
  | 'x_pixel'
  | 'mixpanel';

export type VendorCategory =
  | 'tag_manager'
  | 'analytics'
  | 'ads'
  | 'crm'
  | 'session_replay';

export type TagState = 'loaded' | 'fired' | 'failed' | 'loaded_no_fire';

export type TagOrigin = 'gtm' | 'sgtm' | 'hardcoded' | 'unknown';

export type ConsentValue = 'granted' | 'denied' | 'unknown';

export interface ConsentSnapshot {
  ad_storage: ConsentValue;
  analytics_storage: ConsentValue;
  ad_user_data: ConsentValue;
  ad_personalization: ConsentValue;
  gcs?: string;
  gcd?: string;
  source: 'gcs' | 'gcd' | 'gtag' | 'ics' | 'initial';
  updatedAt: number;
}

export interface DecodedParam {
  key: string;
  label: string;
  value: string;
  group?: 'core' | 'event' | 'user' | 'consent' | 'ecommerce' | 'page' | 'other';
  isPii?: boolean;
  isHashed?: boolean;
}

export interface RawNetworkRequest {
  requestId: string;
  tabId: number;
  url: string;
  method: string;
  resourceType: string;
  timestamp: number;
  requestBody?: string;
  statusCode?: number;
  error?: string;
  initiator?: string;
  initiatorStackUrls?: string[];
  pageUrl?: string;
  source: 'webRequest' | 'devtools';
}

export interface LoadedScript {
  id: string;
  vendorId: VendorId;
  vendorName: string;
  accountId?: string;
  scriptName: string;
  url?: string;
  detectedVia: 'script_request' | 'global';
  origin: TagOrigin;
  statusCode?: number;
  timestamp: number;
  pageUrl: string;
}

export interface ParsedHit {
  id: string;
  requestId: string;
  vendorId: VendorId;
  vendorName: string;
  category: VendorCategory;
  accountId?: string;
  eventName: string;
  endpoint: string;
  url: string;
  method: string;
  status: 'fired' | 'failed' | 'pending';
  statusCode?: number;
  error?: string;
  timestamp: number;
  pageUrl: string;
  origin: TagOrigin;
  params: DecodedParam[];
  rawParams: Record<string, string>;
  eventId?: string;
  gcs?: string;
  gcd?: string;
  consentAtHit?: ConsentSnapshot;
  correlatedEventId?: string;
  correlationReason?: 'event_id' | 'time_window';
  hasServerSideIndicator?: boolean;
  source: 'webRequest' | 'devtools';
}

export interface DataLayerEvent {
  id: string;
  timestamp: number;
  pageUrl: string;
  eventName: string;
  eventId?: string;
  payload: Record<string, unknown>;
  isConsentCommand?: boolean;
  consentCommandType?: 'default' | 'update';
  correlatedHitIds: string[];
}

export interface ConsentChangeEvent {
  id: string;
  timestamp: number;
  pageUrl: string;
  source: ConsentSnapshot['source'];
  previous: ConsentSnapshot;
  current: ConsentSnapshot;
  changedKeys: Array<'ad_storage' | 'analytics_storage' | 'ad_user_data' | 'ad_personalization'>;
}

export interface MarketingCookie {
  id: string;
  name: string;
  vendorId?: VendorId;
  vendorName: string;
  domain: string;
  path: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  expirationDate?: number;
  consentAtCreation: ConsentSnapshot;
  createdBeforeConsent: boolean;
  pageUrl: string;
}

export interface NavigationEvent {
  id: string;
  timestamp: number;
  fromUrl?: string;
  toUrl: string;
  clickIds: {
    gclid?: string;
    fbclid?: string;
  };
}

export type TimelineItem =
  | { kind: 'datalayer'; id: string; timestamp: number; data: DataLayerEvent }
  | { kind: 'hit'; id: string; timestamp: number; data: ParsedHit }
  | { kind: 'script'; id: string; timestamp: number; data: LoadedScript }
  | { kind: 'consent'; id: string; timestamp: number; data: ConsentChangeEvent }
  | { kind: 'cookie'; id: string; timestamp: number; data: MarketingCookie }
  | { kind: 'navigation'; id: string; timestamp: number; data: NavigationEvent };

export type DiagnosticSeverity = 'high' | 'medium' | 'low';

export type DiagnosticRuleId =
  | 'tag_before_consent'
  | 'hit_lost'
  | 'event_without_hit'
  | 'duplicate_hit'
  | 'missing_dedup_key'
  | 'wrong_property'
  | 'pii_in_url'
  | 'click_id_not_stored'
  | 'loaded_no_fire';

export interface Diagnostic {
  id: string;
  ruleId: DiagnosticRuleId;
  severity: DiagnosticSeverity;
  title: string;
  description: string;
  recommendation: string;
  timestamp: number;
  vendorId?: VendorId;
  accountId?: string;
  relatedItemIds: string[];
}

export interface VendorGroup {
  key: string;
  vendorId: VendorId;
  vendorName: string;
  accountId?: string;
  state: TagState;
  scripts: LoadedScript[];
  hits: ParsedHit[];
  origin: TagOrigin;
}

export interface PageClickIdRecord {
  gclid?: string;
  fbclid?: string;
  detectedAt: number;
  pageUrl: string;
}

export interface TabSession {
  tabId: number;
  currentUrl: string;
  origin: string;
  startedAt: number;
  preserveLog: boolean;
  consent: ConsentSnapshot;
  timeline: TimelineItem[];
  scripts: LoadedScript[];
  hits: ParsedHit[];
  dataLayerEvents: DataLayerEvent[];
  consentHistory: ConsentChangeEvent[];
  cookies: MarketingCookie[];
  navigations: NavigationEvent[];
  clickIds: PageClickIdRecord[];
  diagnostics: Diagnostic[];
  hasServerSideGtm: boolean;
  pageLoadedAt?: number;
}

export interface PageObserverMessage {
  source: 'tag-companion-main';
  type:
    | 'datalayer_push'
    | 'consent_command'
    | 'ics_snapshot'
    | 'vendor_global'
    | 'page_context';
  timestamp: number;
  pageUrl: string;
  payload: Record<string, unknown>;
}

export type RuntimeMessage =
  | { type: 'PAGE_OBSERVER_EVENT'; event: PageObserverMessage }
  | { type: 'DEVTOOLS_NETWORK_REQUEST'; tabId: number; request: RawNetworkRequest }
  | { type: 'GET_SESSION'; tabId: number }
  | { type: 'CLEAR_SESSION'; tabId: number }
  | { type: 'SET_PRESERVE_LOG'; tabId: number; preserveLog: boolean }
  | { type: 'ACTIVATE_ORIGIN'; tabId: number; origin: string }
  | { type: 'CHECK_ORIGIN_PERMISSION'; origin: string }
  | { type: 'SESSION_UPDATE'; tabId: number; session: TabSession };
