import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Cookie,
  Database,
  Link2,
  Search,
  Shield,
} from 'lucide-react';
import type {
  TabSession,
  TimelineItem,
} from '@/shared/types';
import { StatusIndicator } from './StatusIndicator';

type TimelineFilter = 'all' | 'datalayer' | 'hit' | 'script' | 'consent' | 'cookie';

interface TimelineViewProps {
  session: TabSession;
  selectedId?: string;
  onSelectItem: (item: TimelineItem) => void;
}

function formatTime(ts: number, startTs: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const rel = ((ts - startTs) / 1000).toFixed(1);
  return `${hh}:${mm}:${ss}.${ms} (+${rel}s)`;
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 60) || '/';
  } catch {
    return url.slice(0, 60);
  }
}

export function TimelineView({
  session,
  selectedId,
  onSelectItem,
}: TimelineViewProps) {
  const [kindFilter, setKindFilter] = useState<TimelineFilter>('all');
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return session.timeline.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter && item.kind !== 'navigation') {
        return false;
      }
      if (!q) return true;
      switch (item.kind) {
        case 'datalayer':
          return (
            item.data.eventName.toLowerCase().includes(q) ||
            JSON.stringify(item.data.payload).toLowerCase().includes(q)
          );
        case 'hit':
          return (
            item.data.vendorName.toLowerCase().includes(q) ||
            item.data.eventName.toLowerCase().includes(q) ||
            (item.data.accountId ?? '').toLowerCase().includes(q) ||
            item.data.endpoint.toLowerCase().includes(q)
          );
        case 'script':
          return (
            item.data.vendorName.toLowerCase().includes(q) ||
            item.data.scriptName.toLowerCase().includes(q)
          );
        case 'cookie':
          return (
            item.data.name.toLowerCase().includes(q) ||
            item.data.vendorName.toLowerCase().includes(q)
          );
        case 'consent':
          return item.data.changedKeys.join(' ').toLowerCase().includes(q);
        case 'navigation':
          return item.data.toUrl.toLowerCase().includes(q);
      }
    });
  }, [session.timeline, kindFilter, query]);

  return (
    <div className="p-3 space-y-3 @3xl:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">Filtrar linha do tempo</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            name="timeline-query"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar evento, vendor, parâmetro…"
            className="h-8 w-full rounded-input bg-cotton pl-8 pr-3 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--color-rule-2)] placeholder:text-muted focus-visible:outline-offset-[-1px]"
          />
        </label>

        <div className="seg no-scrollbar max-w-full overflow-x-auto" role="group" aria-label="Tipo de item">
          {(
            [
              { id: 'all', label: 'Tudo' },
              { id: 'datalayer', label: 'dataLayer' },
              { id: 'hit', label: 'Hits' },
              { id: 'script', label: 'Scripts' },
              { id: 'consent', label: 'Consent' },
              { id: 'cookie', label: 'Cookies' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={kindFilter === f.id}
              onClick={() => setKindFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="panel px-6 py-10 text-center">
          <p className="font-medium text-ink">
            {session.timeline.length === 0 ? 'Linha do tempo vazia' : 'Nada encontrado com esse filtro'}
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-muted">
            {session.timeline.length === 0
              ? 'Pushes do dataLayer, hits dos vendors, mudanças de consentimento e cookies aparecerão aqui em ordem cronológica.'
              : 'Limpe a busca ou escolha outro tipo de item.'}
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-rule overflow-hidden">
          {items.map((item) => {
            if (item.kind === 'navigation') {
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 bg-paper-2 px-3 py-1.5 text-xs text-muted"
                >
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="shrink-0">Navegação para</span>
                  <span className="num min-w-0 flex-1 truncate text-ink-2">
                    {shortPath(item.data.toUrl)}
                  </span>
                  <span className="num shrink-0">
                    {formatTime(item.timestamp, session.startedAt)}
                  </span>
                </div>
              );
            }

            const isSelected = selectedId === item.id;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                data-selected={isSelected ? 'true' : undefined}
                onClick={() => onSelectItem(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item);
                  }
                }}
                className="row flex min-h-9 items-center gap-3 px-3 py-1.5"
              >
                {renderLeadingIcon(item)}
                <div className="min-w-0 flex-1">{renderPrimaryText(item)}</div>
                <div className="hidden shrink-0 items-center gap-3 @lg:flex">
                  {renderRightMeta(item)}
                  <span className="num w-[92px] text-right text-xs text-muted">
                    {formatTime(item.timestamp, session.startedAt).split(' ')[0]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KindIcon({ children, tone }: { children: React.ReactNode; tone: 'ink' | 'success' | 'warn' | 'error' }) {
  const cls =
    tone === 'success'
      ? 'bg-success/12 text-success'
      : tone === 'warn'
        ? 'bg-warn/18 text-warn-ink'
        : tone === 'error'
          ? 'bg-error/12 text-error'
          : 'bg-paper-2 text-ink-2';
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-input ${cls}`}>
      {children}
    </span>
  );
}

function renderLeadingIcon(item: TimelineItem) {
  switch (item.kind) {
    case 'hit':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <StatusIndicator state={item.data.status === 'failed' ? 'failed' : 'fired'} size={14} />
        </span>
      );
    case 'script':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <StatusIndicator state="loaded" size={14} />
        </span>
      );
    case 'datalayer':
      return (
        <KindIcon tone="ink">
          <Database className="h-3 w-3" aria-label="dataLayer" />
        </KindIcon>
      );
    case 'consent':
      return (
        <KindIcon tone="success">
          <Shield className="h-3 w-3" aria-label="Consentimento" />
        </KindIcon>
      );
    case 'cookie':
      return (
        <KindIcon tone={item.data.createdBeforeConsent ? 'error' : 'warn'}>
          <Cookie className="h-3 w-3" aria-label="Cookie" />
        </KindIcon>
      );
    default:
      return null;
  }
}

function renderPrimaryText(item: TimelineItem) {
  switch (item.kind) {
    case 'datalayer':
      return (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="shrink-0 text-xs text-muted">dataLayer</span>
          <span className="truncate font-medium text-ink">{item.data.eventName}</span>
          {item.data.correlatedHitIds.length > 0 && (
            <span className="tag shrink-0">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              <span className="num">{item.data.correlatedHitIds.length}</span>
              {item.data.correlatedHitIds.length > 1 ? 'hits' : 'hit'}
            </span>
          )}
        </div>
      );
    case 'hit':
      return (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="shrink-0 text-ink-2">{item.data.vendorName}</span>
          <span className="truncate font-medium text-ink">{item.data.eventName}</span>
          {item.data.status === 'failed' && (
            <span className="shrink-0 text-xs font-medium text-error @lg:hidden">
              {item.data.error?.replace(/^net::/, '') || `HTTP ${item.data.statusCode}`}
            </span>
          )}
        </div>
      );
    case 'script':
      return (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="shrink-0 text-ink-2">{item.data.vendorName}</span>
          <span className="truncate text-muted">{item.data.scriptName} carregado</span>
        </div>
      );
    case 'consent':
      return (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="shrink-0 font-medium text-ink">Consentimento</span>
          <span className="num truncate text-xs text-ink-2">
            {item.data.changedKeys
              .map((k) => `${k}: ${item.data.previous[k]} → ${item.data.current[k]}`)
              .join(', ')}
          </span>
        </div>
      );
    case 'cookie':
      return (
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="num shrink-0 font-medium text-ink">{item.data.name}</span>
          <span className="truncate text-muted">{item.data.vendorName}</span>
          {item.data.createdBeforeConsent && (
            <span className="shrink-0 text-xs font-medium text-error">antes do consentimento</span>
          )}
        </div>
      );
    default:
      return null;
  }
}

function renderRightMeta(item: TimelineItem) {
  if (item.kind === 'hit') {
    return (
      <span
        className={`num max-w-[220px] truncate text-xs ${
          item.data.status === 'failed' ? 'text-error' : 'text-muted'
        }`}
      >
        {item.data.status === 'failed'
          ? item.data.error?.replace(/^net::/, '') || item.data.statusCode
          : item.data.endpoint}
      </span>
    );
  }
  if (item.kind === 'script') {
    return <span className="num text-xs text-muted">script</span>;
  }
  if (item.kind === 'datalayer' && item.data.eventId) {
    return <span className="num text-xs text-muted">eid {item.data.eventId.slice(0, 10)}</span>;
  }
  return null;
}
