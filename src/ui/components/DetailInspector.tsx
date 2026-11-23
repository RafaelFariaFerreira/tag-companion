import { X, Link2, ShieldAlert } from 'lucide-react';
import type {
  DataLayerEvent,
  LoadedScript,
  MarketingCookie,
  ParsedHit,
  TabSession,
  TimelineItem,
} from '@/shared/types';
import { maskObjectDeep, maskPiiString, maskUrl } from '@/core/pii';
import { StatusIndicator } from './StatusIndicator';

interface DetailInspectorProps {
  session: TabSession;
  item: TimelineItem | null;
  maskPii: boolean;
  onClose: () => void;
  onSelectById: (id: string) => void;
}

const ORIGIN_TEXT: Record<string, string> = {
  gtm: 'Container GTM (gtm.js)',
  sgtm: 'Server-side GTM (domínio próprio)',
  hardcoded: 'Script fixo na página',
  unknown: 'Origem não identificada',
};

export function DetailInspector({
  session,
  item,
  maskPii,
  onClose,
  onSelectById,
}: DetailInspectorProps) {
  if (!item) return null;

  return (
    <aside
      aria-label="Detalhes"
      className="flex flex-col h-full bg-cotton border-l border-rule overflow-hidden"
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-rule px-3.5">
        <span className="min-w-0 truncate text-xs text-muted">
          {item.kind === 'hit' && (
            <>
              Hit de <span className="font-medium text-ink-2">{item.data.vendorName}</span>
            </>
          )}
          {item.kind === 'script' && (
            <>
              Script de <span className="font-medium text-ink-2">{item.data.vendorName}</span>
            </>
          )}
          {item.kind === 'datalayer' && 'Push do dataLayer'}
          {item.kind === 'cookie' && 'Cookie de marketing'}
          {item.kind === 'consent' && 'Mudança de consentimento'}
          {item.kind === 'navigation' && 'Navegação'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost -mr-2 px-2"
          aria-label="Fechar inspetor"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
        {item.kind === 'hit' && (
          <HitDetails
            hit={item.data}
            session={session}
            maskPii={maskPii}
            onSelectById={onSelectById}
          />
        )}
        {item.kind === 'script' && (
          <ScriptDetails script={item.data} maskPii={maskPii} />
        )}
        {item.kind === 'datalayer' && (
          <DataLayerDetails
            ev={item.data}
            session={session}
            maskPii={maskPii}
            onSelectById={onSelectById}
          />
        )}
        {item.kind === 'cookie' && (
          <CookieDetails cookie={item.data} maskPii={maskPii} />
        )}
        {item.kind === 'consent' && (
          <div className="space-y-2 text-[13px]">
            <p className="text-ink-2">
              Fonte: <strong className="font-medium text-ink">{item.data.source}</strong>
            </p>
            <dl className="divide-y divide-rule border-y border-rule">
              {item.data.changedKeys.map((k) => (
                <div key={k} className="flex justify-between gap-3 py-1.5">
                  <dt className="num text-ink-2">{k}</dt>
                  <dd className="num">
                    <span className="text-muted">{item.data.previous[k]} → </span>
                    <span className="text-ink">{item.data.current[k]}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="label mb-1.5">{children}</h3>;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="num rounded-input bg-paper-2 p-2.5 text-xs text-ink-2 break-all">{children}</div>
  );
}

function HitDetails({
  hit,
  session,
  maskPii,
  onSelectById,
}: {
  hit: ParsedHit;
  session: TabSession;
  maskPii: boolean;
  onSelectById: (id: string) => void;
}) {
  const correlatedEvent = hit.correlatedEventId
    ? session.dataLayerEvents.find((e) => e.id === hit.correlatedEventId)
    : undefined;
  const isFailed = hit.status === 'failed';

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusIndicator state={isFailed ? 'failed' : 'fired'} size={16} />
          <h2 className="text-[17px] text-ink">{hit.eventName}</h2>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
          {hit.accountId && (
            <>
              <dt className="text-muted">Conta</dt>
              <dd className="num text-ink">{hit.accountId}</dd>
            </>
          )}
          <dt className="text-muted">Resposta</dt>
          <dd className={`num ${isFailed ? 'text-error' : 'text-ink'}`}>
            {hit.method}{' '}
            {isFailed ? hit.error || `HTTP ${hit.statusCode}` : `HTTP ${hit.statusCode ?? 200}`}
          </dd>
          <dt className="text-muted">Origem</dt>
          <dd className="text-ink">{ORIGIN_TEXT[hit.origin] ?? hit.origin}</dd>
        </dl>
      </div>

      {correlatedEvent && (
        <div className="rounded-input bg-paper-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">
                Disparado pelo push <strong className="font-medium">{correlatedEvent.eventName}</strong>
              </span>
            </span>
            <button
              type="button"
              onClick={() => onSelectById(correlatedEvent.id)}
              className="shrink-0 text-xs font-medium text-ink underline decoration-accent-2 underline-offset-2 hover:decoration-2"
            >
              Abrir push
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {hit.correlationReason === 'event_id'
              ? `Correlação exata por event_id (${hit.eventId})`
              : `Correlação temporal (${Math.max(0, hit.timestamp - correlatedEvent.timestamp)} ms após o push)`}
          </p>
        </div>
      )}

      {hit.consentAtHit && (
        <div>
          <SectionTitle>Consentimento no momento do hit</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-4 border-y border-rule py-1 text-[13px]">
            {(
              [
                ['ad_storage', hit.consentAtHit.ad_storage],
                ['analytics', hit.consentAtHit.analytics_storage],
                ['gcs', hit.gcs],
                ['gcd', hit.gcd],
              ] as const
            )
              .filter(([, v]) => Boolean(v))
              .map(([k, v]) => (
                <div key={k} className="flex min-w-0 justify-between gap-2 py-1">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num min-w-0 truncate text-ink">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <div>
        <SectionTitle>
          Parâmetros decodificados <span className="num">{hit.params.length}</span>
        </SectionTitle>
        <dl className="divide-y divide-rule border-y border-rule">
          {hit.params.map((p) => {
            const displayVal = maskPii ? maskPiiString(p.value, p.key) : p.value;
            return (
              <div key={`${p.key}:${p.value.slice(0, 12)}`} className="py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[13px] font-medium text-ink">{p.label}</dt>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.isPii && (
                      <span className="tag text-warn-ink">
                        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                        PII
                      </span>
                    )}
                    <span className="num text-[11px] text-muted">{p.key}</span>
                  </div>
                </div>
                <dd className="num text-xs text-ink-2 break-all">{displayVal}</dd>
              </div>
            );
          })}
        </dl>
      </div>

      <div>
        <SectionTitle>URL da requisição</SectionTitle>
        <CodeBlock>{maskPii ? maskUrl(hit.url) : hit.url}</CodeBlock>
      </div>
    </div>
  );
}

function ScriptDetails({ script, maskPii }: { script: LoadedScript; maskPii: boolean }) {
  return (
    <div className="space-y-5 text-[13px]">
      <div className="flex items-center gap-2">
        <StatusIndicator state="loaded" size={16} />
        <h2 className="text-[17px] text-ink">{script.scriptName}</h2>
      </div>
      <dl className="divide-y divide-rule border-y border-rule">
        <Row label="Vendor" value={script.vendorName} />
        {script.accountId && <Row label="ID da conta" value={script.accountId} mono />}
        <Row
          label="Detecção"
          value={
            script.detectedVia === 'script_request'
              ? 'Requisição de script'
              : 'Global JS presente na página'
          }
        />
        <Row label="Origem" value={ORIGIN_TEXT[script.origin] ?? script.origin} />
        {script.statusCode && <Row label="Status HTTP" value={String(script.statusCode)} mono />}
      </dl>
      {script.url && (
        <div>
          <SectionTitle>URL do script</SectionTitle>
          <CodeBlock>{maskPii ? maskUrl(script.url) : script.url}</CodeBlock>
        </div>
      )}
    </div>
  );
}

function DataLayerDetails({
  ev,
  session,
  maskPii,
  onSelectById,
}: {
  ev: DataLayerEvent;
  session: TabSession;
  maskPii: boolean;
  onSelectById: (id: string) => void;
}) {
  const correlatedHits = ev.correlatedHitIds
    .map((id) => session.hits.find((h) => h.id === id))
    .filter((h): h is ParsedHit => Boolean(h));

  const payload = maskPii ? maskObjectDeep(ev.payload) : ev.payload;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] text-ink">{ev.eventName}</h2>
        {ev.eventId && (
          <p className="mt-0.5 text-xs text-muted">
            event_id <span className="num text-ink-2">{ev.eventId}</span>
          </p>
        )}
      </div>

      <div>
        <SectionTitle>
          Hits correlacionados <span className="num">{correlatedHits.length}</span>
        </SectionTitle>
        {correlatedHits.length === 0 ? (
          <p className="text-[13px] text-muted">
            Nenhum hit de vendor correlacionado a este evento.
          </p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {correlatedHits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => onSelectById(hit.id)}
                  className="row flex h-8 w-full items-center gap-2 px-1 text-left text-[13px]"
                >
                  <StatusIndicator state={hit.status === 'failed' ? 'failed' : 'fired'} size={12} />
                  <span className="font-medium text-ink">{hit.vendorName}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{hit.eventName}</span>
                  <span className="num shrink-0 text-xs text-muted">{hit.endpoint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SectionTitle>Payload do dataLayer.push</SectionTitle>
        <pre className="num overflow-x-auto rounded-input bg-board p-3 text-xs leading-relaxed text-board-type">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function CookieDetails({ cookie, maskPii }: { cookie: MarketingCookie; maskPii: boolean }) {
  return (
    <div className="space-y-5 text-[13px]">
      <h2 className="num text-[17px] text-ink">{cookie.name}</h2>
      <dl className="divide-y divide-rule border-y border-rule">
        <Row label="Vendor" value={cookie.vendorName} />
        <Row label="Domínio" value={cookie.domain} mono />
        <Row
          label="Valor"
          value={
            maskPii && cookie.value.length > 10
              ? `${cookie.value.slice(0, 6)}…${cookie.value.slice(-4)}`
              : cookie.value
          }
          mono
        />
        <Row
          label="Criado antes do consentimento"
          value={cookie.createdBeforeConsent ? 'Sim (alerta)' : 'Não'}
          tone={cookie.createdBeforeConsent ? 'error' : undefined}
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'error';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd
        className={`text-right break-all ${tone === 'error' ? 'text-error' : 'text-ink'} ${
          mono ? 'num text-xs' : 'font-medium'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
