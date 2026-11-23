import type {
  ParsedHit,
  RawNetworkRequest,
  VendorCategory,
  VendorId,
} from '@/shared/types';

export interface VendorMatch {
  vendorId: VendorId;
  vendorName: string;
  kind: 'script' | 'hit';
  scriptName?: string;
  accountId?: string;
  isServerSide?: boolean;
}

export interface VendorModule {
  id: VendorId;
  name: string;
  category: VendorCategory;
  match(url: string, resourceType?: string): VendorMatch | null;
  parse(request: RawNetworkRequest): ParsedHit[];
  label(param: string): string;
}
