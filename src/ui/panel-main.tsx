import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startDevtoolsNetworkBridge } from '@/devtools/network-bridge';
import { App } from './App';
import './index.css';

if (typeof chrome !== 'undefined' && chrome.devtools?.inspectedWindow?.tabId !== undefined) {
  startDevtoolsNetworkBridge(chrome.devtools.inspectedWindow.tabId);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App mode="devtools" />
  </StrictMode>,
);
