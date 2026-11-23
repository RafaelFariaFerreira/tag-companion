import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import type { LoadedScript, ParsedHit, TimelineItem } from '@/shared/types';
import { createTabSession } from '@/core/session-store';
import { exportSession } from '@/core/exporter';
import { useSession } from './hooks/useSession';
import { TopBar } from './components/TopBar';
import { VendorView } from './components/VendorView';
import { TimelineView } from './components/TimelineView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { ConsentCookiesView } from './components/ConsentCookiesView';
import { DetailInspector } from './components/DetailInspector';

type ActiveTab = 'vendors' | 'timeline' | 'diagnostics' | 'consent';

interface AppProps {
  mode: 'devtools' | 'sidepanel';
}

export function App({ mode }: AppProps) {
  const {
    session: liveSession,
    originGranted,
    sitePaused,
    isRestrictedPage,
    setMonitoring,
    requestOriginPermission,
    clearSession,
    setPreserveLog,
  } = useSession(mode);

  const [activeTab, setActiveTab] = useState<ActiveTab>('vendors');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [maskPii, setMaskPii] = useState<boolean>(true);

  const session = useMemo(
    () => liveSession ?? createTabSession(-1, '', true),
    [liveSession],
  );

  const selectedItem: TimelineItem | null = useMemo(() => {
    if (!selectedId) return null;
    const inTimeline = session.timeline.find((t) => t.id === selectedId);
    if (inTimeline) return inTimeline;

    const hit = session.hits.find((h) => h.id === selectedId);
    if (hit) return { kind: 'hit', id: hit.id, timestamp: hit.timestamp, data: hit };

    const script = session.scripts.find((s) => s.id === selectedId);
    if (script) {
      return { kind: 'script', id: script.id, timestamp: script.timestamp, data: script };
    }

    const dl = session.dataLayerEvents.find((e) => e.id === selectedId);
    if (dl) {
      return { kind: 'datalayer', id: dl.id, timestamp: dl.timestamp, data: dl };
    }

    const ck = session.cookies.find((c) => c.id === selectedId);
    if (ck) {
      return { kind: 'cookie', id: ck.id, timestamp: ck.createdAt, data: ck };
    }

    return null;
  }, [selectedId, session]);

  const highDiagCount = session.diagnostics.filter((d) => d.severity === 'high').length;
  const totalDiagCount = session.diagnostics.length;

  const handleExport = () => {
    const exported = exportSession(session, { maskPii: true });
    const blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const host = (() => {
      try {
        return new URL(session.currentUrl).hostname || 'session';
      } catch {
        return 'session';
      }
    })();
    a.href = url;
    a.download = `tag-companion-${host}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectHit = (hit: ParsedHit) => {
    setSelectedId(hit.id);
  };

  const handleSelectScript = (script: LoadedScript) => {
    setSelectedId(script.id);
  };

  const handleJumpToItem = (itemId: string) => {
    setSelectedId(itemId);
    setActiveTab('timeline');
  };

  const isCompact = mode === 'sidepanel';

  const tabs = [
    {
      id: 'vendors',
      label: 'Por Vendor',
      Icon: Layers,
      badge: session.hits.length + session.scripts.length,
      alert: false,
    },
    {
      id: 'timeline',
      label: 'Linha do tempo',
      Icon: Activity,
      badge: session.timeline.length,
      alert: false,
    },
    {
      id: 'diagnostics',
      label: 'Diagnósticos',
      Icon: AlertTriangle,
      badge: totalDiagCount,
      alert: highDiagCount > 0,
    },
    {
      id: 'consent',
      label: 'Consentimento & Cookies',
      Icon: ShieldCheck,
      badge: session.cookies.length,
      alert: false,
    },
  ] as const;

  return (
    <div className="flex flex-col h-screen bg-paper text-ink overflow-hidden">
      <TopBar
        session={session}
        originGranted={originGranted}
        sitePaused={sitePaused}
        onSetMonitoring={setMonitoring}
        isRestrictedPage={isRestrictedPage}
        maskPii={maskPii}
        onToggleMaskPii={() => setMaskPii((v) => !v)}
        onTogglePreserveLog={setPreserveLog}
        onClear={() => {
          setSelectedId(null);
          clearSession();
        }}
        onExport={handleExport}
        onRequestPermission={requestOriginPermission}
        onOpenConsentTab={() => setActiveTab('consent')}
        compact={isCompact}
      />

      <nav
        aria-label="Visualizações"
        className="no-scrollbar flex items-stretch overflow-x-auto border-b border-rule bg-cotton px-1.5"
      >
        {tabs.map(({ id, label, Icon, badge, alert }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
              className={`relative inline-flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-[var(--dur-micro)] ${
                active ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {!isCompact && <Icon className="h-4 w-4" aria-hidden="true" />}
              <span>{label}</span>
              {badge > 0 && (
                <span
                  className={`num rounded-pill px-1.5 text-[11px] leading-[18px] ${
                    alert ? 'bg-error/12 text-error' : 'bg-paper-2 text-muted'
                  }`}
                >
                  {badge}
                </span>
              )}
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 bottom-0 h-0.5 rounded-pill transition-opacity duration-[var(--dur-micro)] ${
                  active ? 'bg-accent opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          );
        })}
      </nav>

      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        <main className="@container flex-1 overflow-y-auto min-w-0">
          {activeTab === 'vendors' && (
            <VendorView
              session={session}
              selectedId={selectedId ?? undefined}
              onSelectHit={handleSelectHit}
              onSelectScript={handleSelectScript}
            />
          )}
          {activeTab === 'timeline' && (
            <TimelineView
              session={session}
              selectedId={selectedId ?? undefined}
              onSelectItem={(item) => setSelectedId(item.id)}
            />
          )}
          {activeTab === 'diagnostics' && (
            <DiagnosticsView session={session} onJumpToItem={handleJumpToItem} />
          )}
          {activeTab === 'consent' && (
            <ConsentCookiesView session={session} maskPii={maskPii} />
          )}
        </main>

        {selectedItem && (
          <div
            className={
              isCompact
                ? 'absolute inset-0 z-20 bg-cotton'
                : 'w-[380px] lg:w-[440px] shrink-0 h-full'
            }
          >
            <DetailInspector
              session={session}
              item={selectedItem}
              maskPii={maskPii}
              onClose={() => setSelectedId(null)}
              onSelectById={(id) => setSelectedId(id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
