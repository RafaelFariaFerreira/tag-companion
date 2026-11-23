import type { RawNetworkRequest, RuntimeMessage } from '@/shared/types';
import { matchVendorRequest } from '@/vendors';

interface HarInitiator {
  type?: string;
  url?: string;
  stack?: {
    callFrames?: Array<{ url?: string }>;
    parent?: {
      callFrames?: Array<{ url?: string }>;
    };
  };
}

function extractStackUrls(initiator?: HarInitiator): string[] {
  if (!initiator) return [];
  const urls: string[] = [];
  if (initiator.url) urls.push(initiator.url);

  const frames = initiator.stack?.callFrames ?? [];
  for (const frame of frames) {
    if (frame.url) urls.push(frame.url);
  }
  const parentFrames = initiator.stack?.parent?.callFrames ?? [];
  for (const frame of parentFrames) {
    if (frame.url) urls.push(frame.url);
  }
  return urls;
}

let devtoolsSeq = 0;

/**
 * Attaches chrome.devtools.network listener to enrich hits with full POST bodies
 * (e.g. GA4 multi-line batches) and exact initiator stack traces (for Tag Origin detection).
 */
export function startDevtoolsNetworkBridge(tabId: number): () => void {
  if (!chrome.devtools?.network?.onRequestFinished) {
    return () => {};
  }

  const listener = (entry: chrome.devtools.network.Request) => {
    const url = entry.request?.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    const resourceType =
      (entry as unknown as { _resourceType?: string })._resourceType ?? 'other';

    if (!matchVendorRequest(url, resourceType)) return;

    devtoolsSeq += 1;
    const initiator = (entry as unknown as { _initiator?: HarInitiator })._initiator;
    const stackUrls = extractStackUrls(initiator);
    const statusCode = entry.response?.status;
    const errorText = (entry.response as unknown as { _error?: string })?._error;

    const request: RawNetworkRequest = {
      requestId: `dt_${Date.now()}_${devtoolsSeq}`,
      tabId,
      url,
      method: entry.request.method || 'GET',
      resourceType,
      timestamp: entry.startedDateTime
        ? Date.parse(entry.startedDateTime)
        : Date.now(),
      requestBody: entry.request.postData?.text,
      statusCode: typeof statusCode === 'number' && statusCode > 0 ? statusCode : undefined,
      error: errorText || (statusCode === 0 ? 'net::ERR_ABORTED' : undefined),
      initiator: initiator?.url || stackUrls[0],
      initiatorStackUrls: stackUrls,
      source: 'devtools',
    };

    const msg: RuntimeMessage = {
      type: 'DEVTOOLS_NETWORK_REQUEST',
      tabId,
      request,
    };

    chrome.runtime.sendMessage(msg).catch(() => {});
  };

  chrome.devtools.network.onRequestFinished.addListener(listener);
  return () => {
    chrome.devtools.network.onRequestFinished.removeListener(listener);
  };
}
