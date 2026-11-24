// Dev-only preview: renders the real App with a fake chrome API and seeded data.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { seedSession } from './seed';
import '@/ui/index.css';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') as 'devtools' | 'sidepanel') ?? 'devtools';
const empty = params.has('empty');
const session = empty ? null : seedSession();
const noop = { addListener() {}, removeListener() {} };
// In-memory chrome.storage.local with change events
const store: Record<string, unknown> = {};
const storageListeners = new Set<(c: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>();
let granted_ = !params.has('nogrant');
(globalThis as any).chrome = {
  devtools: mode === 'devtools' ? { inspectedWindow: { tabId: 7 } } : undefined,
  tabs: {
    get: async () => ({ id: 7, url: 'https://loja.exemplo.com.br/checkout/obrigado' }),
    query: async () => [{ id: 7, url: 'https://loja.exemplo.com.br/checkout/obrigado' }],
    onActivated: noop, onUpdated: noop,
  },
  runtime: {
    connect: () => ({ onMessage: noop, disconnect() {} }),
    sendMessage: async (m: any) => (m.type === 'GET_SESSION' ? { session } : m.type === 'CHECK_ORIGIN_PERMISSION' ? { granted: granted_ } : {}),
    onMessage: noop,
    getManifest: () => ({ host_permissions: [] }),
  },
  permissions: {
    contains: async () => granted_,
    request: async () => { granted_ = true; return true; },
    getAll: async () => ({ origins: granted_ ? ['https://loja.exemplo.com.br/*'] : [] }),
    remove: async () => { granted_ = false; return true; },
    onAdded: noop,
    onRemoved: noop,
  },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
        storageListeners.forEach((l) => l(changes, 'local'));
      },
    },
    onChanged: {
      addListener: (l: any) => storageListeners.add(l),
      removeListener: (l: any) => storageListeners.delete(l),
    },
  },
};

const { App } = await import('@/ui/App');
createRoot(document.getElementById('root')!).render(<StrictMode><App mode={mode} /></StrictMode>);
