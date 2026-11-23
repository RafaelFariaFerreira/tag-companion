// Dev-only preview: renders the real App with a fake chrome API and seeded data.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { seedSession } from './seed';
import '@/ui/index.css';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') as 'devtools' | 'sidepanel') ?? 'devtools';
const empty = params.has('empty');
const session = empty ? null : seedSession();
const granted = !params.has('nogrant');
const noop = { addListener() {}, removeListener() {} };
(globalThis as any).chrome = {
  devtools: mode === 'devtools' ? { inspectedWindow: { tabId: 7 } } : undefined,
  tabs: {
    get: async () => ({ id: 7, url: 'https://loja.exemplo.com.br/checkout/obrigado' }),
    query: async () => [{ id: 7, url: 'https://loja.exemplo.com.br/checkout/obrigado' }],
    onActivated: noop, onUpdated: noop,
  },
  runtime: {
    connect: () => ({ onMessage: noop, disconnect() {} }),
    sendMessage: async (m: any) => (m.type === 'GET_SESSION' ? { session } : m.type === 'CHECK_ORIGIN_PERMISSION' ? { granted } : {}),
    onMessage: noop,
  },
  permissions: { contains: async () => granted, request: async () => true },
};

const { App } = await import('@/ui/App');
createRoot(document.getElementById('root')!).render(<StrictMode><App mode={mode} /></StrictMode>);
