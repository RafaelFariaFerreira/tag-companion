import { useMemo, useState } from 'react';
import type {
  LoadedScript,
  ParsedHit,
  TabSession,
  TagOrigin,
  VendorGroup,
} from '@/shared/types';
import { buildVendorGroups } from '@/core/session-store';
import { StatusIndicator } from './StatusIndicator';

type VendorFilter = 'all' | 'loaded' | 'fired' | 'issues';

export type SelectedEntity =
  | { kind: 'hit'; item: ParsedHit }
  | { kind: 'script'; item: LoadedScript }
  | { kind: 'datalayer'; id: string }
  | { kind: 'cookie'; id: string }
  | { kind: 'consent'; id: string };

interface VendorViewProps {
  session: TabSession;
  selectedId?: string;
  onSelectHit: (hit: ParsedHit) => void;
  onSelectScript: (script: LoadedScript) => void;
}

function originBadge(origin: TagOrigin): string | null {
  if (origin === 'sgtm') return 'sGTM';
  if (origin === 'gtm') return 'via GTM';
  if (origin === 'hardcoded') return 'Fixo na página';
  return null;
}

function formatFailureLabel(hit: ParsedHit): string {
  if (hit.error?.includes('ERR_ABORTED')) return 'cancelado';
  if (hit.error?.includes('ERR_BLOCKED_BY_CLIENT')) return 'bloqueado';
  if (hit.statusCode && hit.statusCode >= 400) return `HTTP ${hit.statusCode}`;
  return 'falhou';
}

function formatRightColumn(hit: ParsedHit): string {
  if (hit.status === 'failed') {
    return hit.error
      ? hit.error.replace(/^net::/, '')
      : hit.statusCode
        ? `HTTP ${hit.statusCode}`
        : 'FAILED';
  }
  return hit.endpoint;
}

export function VendorView({
  session,
  selectedId,
  onSelectHit,
  onSelectScript,
}: VendorViewProps) {
  const [filter, setFilter] = useState<VendorFilter>('all');

  const groups = useMemo(() => buildVendorGroups(session), [session]);

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (filter === 'all') return true;
      if (filter === 'loaded') {
        return group.scripts.length > 0;
      }
      if (filter === 'fired') {
        return group.hits.some((h) => h.status === 'fired');
      }
      if (filter === 'issues') {
        return (
          group.state === 'loaded_no_fire' ||
          group.hits.some((h) => h.status === 'failed')
        );
      }
      return true;
    });
  }, [groups, filter]);

  const counts = useMemo(() => {
    const loadedCount = groups.reduce((acc, g) => acc + g.scripts.length, 0);
    const firedCount = session.hits.filter((h) => h.status === 'fired').length;
    const issueCount =
      groups.filter((g) => g.state === 'loaded_no_fire').length +
      session.hits.filter((h) => h.status === 'failed').length;
    return { total: groups.length, loadedCount, firedCount, issueCount };
  }, [groups, session.hits]);

  const stats = [
    { id: 'all', label: 'Tudo', value: counts.total, alert: false },
    { id: 'loaded', label: 'Só carregado', value: counts.loadedCount, alert: false },
    { id: 'fired', label: 'Só disparado', value: counts.firedCount, alert: false },
    { id: 'issues', label: 'Alertas', value: counts.issueCount, alert: counts.issueCount > 0 },
  ] as const;

  return (
    <div className="p-3 space-y-3 @3xl:p-4">
      {/* The stats are the filter: each figure scopes the ledger below it.
          Narrow panels get the same filter as one segmented row. */}
      <div className="seg no-scrollbar max-w-full overflow-x-auto @xl:hidden" role="group" aria-label="Filtrar vendors">
        {stats.map((stat) => (
          <button
            key={stat.id}
            type="button"
            aria-pressed={filter === stat.id}
            onClick={() => setFilter(stat.id)}
          >
            {stat.label}{' '}
            <span className={`num ${stat.alert ? 'text-error' : ''}`}>{stat.value}</span>
          </button>
        ))}
      </div>

      <div
        role="group"
        aria-label="Filtrar vendors"
        className="panel hidden grid-cols-4 overflow-hidden @xl:grid"
      >
        {stats.map((stat, i) => {
          const active = filter === stat.id;
          return (
            <button
              key={stat.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(stat.id)}
              className={`row relative flex flex-col items-start gap-0.5 px-3.5 py-2.5 text-left ${
                i > 0 ? 'border-l border-rule' : ''
              } ${active ? '!bg-paper-2' : ''}`}
            >
              <span className={`label whitespace-nowrap ${active ? '!text-ink' : ''}`}>
                {stat.label}
              </span>
              <span className={`num text-xl leading-tight ${stat.alert ? 'text-error' : 'text-ink'}`}>
                {stat.value}
              </span>
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-opacity duration-[var(--dur-micro)] ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>

      <ul
        aria-label="Legenda dos estados"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-xs text-muted"
      >
        <li className="inline-flex items-center gap-1.5">
          <StatusIndicator state="loaded" size={12} />
          Carregado
        </li>
        <li className="inline-flex items-center gap-1.5">
          <StatusIndicator state="fired" size={12} />
          Disparado
        </li>
        <li className="inline-flex items-center gap-1.5">
          <StatusIndicator state="failed" size={12} />
          Falhou
        </li>
        <li className="inline-flex items-center gap-1.5">
          <StatusIndicator state="loaded_no_fire" size={12} />
          Carregou, não disparou
        </li>
      </ul>

      {filteredGroups.length === 0 ? (
        <div className="panel px-6 py-10 text-center">
          <p className="font-medium text-ink">
            {groups.length === 0
              ? 'Nenhum vendor capturado ainda'
              : 'Nenhum vendor neste filtro'}
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-muted">
            {groups.length === 0
              ? 'Recarregue a página ou dispare uma ação (clique, envio de formulário) para ver scripts carregados e hits disparados.'
              : 'Escolha outro filtro acima para ver os demais vendors.'}
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-rule overflow-hidden">
          {filteredGroups.map((group) => (
            <VendorGroupBlock
              key={group.key}
              group={group}
              filter={filter}
              selectedId={selectedId}
              onSelectHit={onSelectHit}
              onSelectScript={onSelectScript}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface VendorGroupBlockProps {
  group: VendorGroup;
  filter: VendorFilter;
  selectedId?: string;
  onSelectHit: (hit: ParsedHit) => void;
  onSelectScript: (script: LoadedScript) => void;
}

function VendorGroupBlock({
  group,
  filter,
  selectedId,
  onSelectHit,
  onSelectScript,
}: VendorGroupBlockProps) {
  const badge = originBadge(group.origin);
  const primaryScript = group.scripts[0];
  const isLoadedNoFire = group.state === 'loaded_no_fire';
  const firedCount = group.hits.filter((h) => h.status === 'fired').length;
  const failedCount = group.hits.filter((h) => h.status === 'failed').length;

  const visibleHits = group.hits.filter((h) => {
    if (filter === 'loaded') return false;
    if (filter === 'fired') return h.status === 'fired';
    if (filter === 'issues') return h.status === 'failed';
    return true;
  });

  const scriptDisplayLabel = primaryScript
    ? isLoadedNoFire
      ? `${primaryScript.scriptName} carregado, nenhum disparo`
      : `${primaryScript.scriptName} carregado`
    : 'biblioteca não interceptada (hit direto)';

  return (
    <section className="pb-1.5" aria-label={group.vendorName}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <h3 className="min-w-0 truncate text-[14px] font-semibold text-ink">
          {group.vendorName}
        </h3>
        {group.accountId && (
          <span className="num min-w-0 truncate text-xs text-muted">{group.accountId}</span>
        )}
        {badge && <span className="tag hidden @md:inline-flex">{badge}</span>}
        <span className="ml-auto shrink-0 text-xs text-muted">
          {group.hits.length > 0 ? (
            <>
              <span className="num text-ink-2">{firedCount}</span>{' '}
              {firedCount === 1 ? 'disparo' : 'disparos'}
              {failedCount > 0 && (
                <span className="text-error">
                  {', '}
                  <span className="num">{failedCount}</span>{' '}
                  {failedCount === 1 ? 'falha' : 'falhas'}
                </span>
              )}
            </>
          ) : group.vendorId === 'gtm' ? (
            'container'
          ) : (
            'sem disparos'
          )}
        </span>
      </div>

      <div
        role={primaryScript ? 'button' : undefined}
        tabIndex={primaryScript ? 0 : undefined}
        aria-pressed={primaryScript ? selectedId === primaryScript.id : undefined}
        data-selected={primaryScript && selectedId === primaryScript.id ? 'true' : undefined}
        onClick={() => primaryScript && onSelectScript(primaryScript)}
        onKeyDown={(e) => {
          if (primaryScript && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectScript(primaryScript);
          }
        }}
        className={`${primaryScript ? 'row' : ''} flex h-8 items-center gap-3 px-3`}
      >
        <StatusIndicator state={isLoadedNoFire ? 'loaded_no_fire' : 'loaded'} size={14} />
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            isLoadedNoFire ? 'text-warn-ink' : 'text-muted'
          }`}
        >
          {scriptDisplayLabel}
        </span>
        <span className="num shrink-0 text-xs text-muted">script</span>
      </div>

      {visibleHits.length > 0 && (
        <div className="relative ml-[18px] border-l border-rule-2">
          {visibleHits.map((hit) => {
            const isSelected = selectedId === hit.id;
            const isFailed = hit.status === 'failed';
            return (
              <div
                key={hit.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                data-selected={isSelected ? 'true' : undefined}
                onClick={() => onSelectHit(hit)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectHit(hit);
                  }
                }}
                className="row relative flex min-h-8 items-center gap-3 py-1 pl-4 pr-3"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-1/2 w-2.5 border-t border-rule-2"
                />
                <StatusIndicator state={isFailed ? 'failed' : 'fired'} size={14} />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {hit.eventName}
                  </span>
                  {isFailed && (
                    <span className="shrink-0 text-[13px] font-medium text-error">
                      {formatFailureLabel(hit)}
                    </span>
                  )}
                  {hit.gcs && (
                    <span
                      title={`Consentimento enviado: ${hit.gcs}`}
                      className="tag num"
                    >
                      {hit.gcs}
                    </span>
                  )}
                  {hit.correlatedEventId && (
                    <span
                      title={
                        hit.correlationReason === 'event_id'
                          ? 'Correlacionado por event_id'
                          : 'Correlacionado com dataLayer (janela 3 s)'
                      }
                      className="tag"
                    >
                      {hit.correlationReason === 'event_id' ? 'event_id' : 'dataLayer'}
                    </span>
                  )}
                  <span
                    className={`num basis-full truncate text-[11px] @md:hidden ${
                      isFailed ? 'text-error' : 'text-muted'
                    }`}
                  >
                    {formatRightColumn(hit)}
                  </span>
                </span>
                <span
                  className={`num hidden max-w-[45%] shrink truncate text-xs @md:block ${
                    isFailed ? 'text-error' : 'text-muted'
                  }`}
                  title={hit.url}
                >
                  {formatRightColumn(hit)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
