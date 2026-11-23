import {
  Check,
  History,
  Download,
  Eye,
  EyeOff,
  Minus,
  Trash2,
  X,
} from 'lucide-react';
import type { ConsentValue, TabSession } from '@/shared/types';

interface TopBarProps {
  session: TabSession | null;
  originGranted: boolean;
  sitePaused: boolean;
  onSetMonitoring: (on: boolean) => void;
  isRestrictedPage: boolean;
  maskPii: boolean;
  onToggleMaskPii: () => void;
  onTogglePreserveLog: (value: boolean) => void;
  onClear: () => void;
  onExport: () => void;
  onRequestPermission: () => void;
  onOpenConsentTab: () => void;
  compact?: boolean;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function ConsentValueMark({ value }: { value: ConsentValue }) {
  if (value === 'granted') {
    return <Check aria-label="granted" className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />;
  }
  if (value === 'denied') {
    return <X aria-label="denied" className="h-3.5 w-3.5 text-error" strokeWidth={2.5} />;
  }
  return <Minus aria-label="desconhecido" className="h-3.5 w-3.5 text-muted" strokeWidth={2.5} />;
}

export function TopBar({
  session,
  originGranted,
  sitePaused,
  onSetMonitoring,
  isRestrictedPage,
  maskPii,
  onToggleMaskPii,
  onTogglePreserveLog,
  onClear,
  onExport,
  onRequestPermission,
  onOpenConsentTab,
  compact = false,
}: TopBarProps) {
  const host = getHostname(session?.currentUrl ?? '');
  const consent = session?.consent;
  const preserveLog = session?.preserveLog ?? true;
  const monitoring = originGranted && !sitePaused;
  const switchLabel = monitoring ? 'Monitorando' : sitePaused && originGranted ? 'Pausado' : 'Desativado';
  const switchTitle = monitoring
    ? `Pausar a coleta em ${host || 'este site'} (a permissão continua)`
    : originGranted
      ? `Retomar a coleta em ${host || 'este site'}`
      : `Ativar o monitoramento em ${host || 'este site'} (pede permissão)`;

  return (
    <header className="bg-cotton border-b border-rule">
      <div className="flex items-center gap-3 px-3 h-12">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-ink whitespace-nowrap">
            <img src="/icons/icon-32.png" width={20} height={20} alt="" className="h-5 w-5" />
            {compact ? <span className="sr-only">Tag Companion</span> : 'Tag Companion'}
          </span>
          {!isRestrictedPage && (
            <button
              type="button"
              role="switch"
              aria-checked={monitoring}
              aria-label={`Coleta neste site: ${switchLabel}`}
              title={switchTitle}
              onClick={() => onSetMonitoring(!monitoring)}
              className="switch shrink-0"
            >
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className={`text-xs font-medium ${monitoring ? 'text-success' : 'text-muted'}`}>
                {switchLabel}
              </span>
            </button>
          )}
          {host && !compact && (
            <span className="num text-xs text-muted truncate min-w-0" title={host}>
              {host}
            </span>
          )}
        </div>

        <div className={`flex items-center shrink-0 ${compact ? '[&_.btn]:px-1.5' : 'gap-1'}`}>
          {consent && (
            <button
              type="button"
              onClick={onOpenConsentTab}
              title="Ver estado de consentimento e cookies"
              className={`btn btn-ghost ${compact ? 'gap-1.5 px-1.5' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                ads <ConsentValueMark value={consent.ad_storage} />
              </span>
              <span className="inline-flex items-center gap-1">
                {compact ? <abbr title="analytics" className="no-underline">an</abbr> : 'analytics'}{' '}
                <ConsentValueMark value={consent.analytics_storage} />
              </span>
              {consent.gcs && !compact && <span className="num text-muted">{consent.gcs}</span>}
            </button>
          )}

          <label
            className={`btn btn-ghost select-none cursor-pointer ${compact ? 'gap-1' : ''}`}
            title="Manter o registro ao navegar entre páginas"
          >
            <input
              type="checkbox"
              checked={preserveLog}
              onChange={(e) => onTogglePreserveLog(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            />
            {compact ? (
              <>
                <History className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Preserve log</span>
              </>
            ) : (
              'Preserve log'
            )}
          </label>

          {!compact && <span className="mx-1 h-5 w-px bg-rule" aria-hidden="true" />}

          <button
            type="button"
            onClick={onToggleMaskPii}
            aria-pressed={!maskPii}
            title={
              maskPii
                ? 'PII mascarada (clique para revelar localmente)'
                : 'PII visível localmente (clique para mascarar)'
            }
            className={`btn btn-ghost ${maskPii ? '' : 'text-warn-ink'}`}
          >
            {maskPii ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
            {compact ? (
              <span className="sr-only">{maskPii ? 'PII oculta' : 'PII visível'}</span>
            ) : maskPii ? (
              'PII oculta'
            ) : (
              'PII visível'
            )}
          </button>

          <button
            type="button"
            onClick={onExport}
            title="Exportar sessão em JSON (PII mascarada)"
            className="btn btn-ghost"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {compact ? <span className="sr-only">Exportar</span> : 'Exportar'}
          </button>

          <button
            type="button"
            onClick={onClear}
            title="Limpar sessão atual"
            className="btn btn-ghost hover:!text-error"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {compact ? <span className="sr-only">Limpar</span> : 'Limpar'}
          </button>
        </div>
      </div>

      {!isRestrictedPage && originGranted && sitePaused && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule bg-paper-2 px-3 py-2">
          <p className="text-[13px] text-ink-2 min-w-0 flex-1 basis-60">
            Coleta pausada em <strong className="font-semibold text-ink">{host || 'este site'}</strong>. A
            permissão continua; o que aparece abaixo foi capturado antes da pausa.
          </p>
          <button type="button" onClick={() => onSetMonitoring(true)} className="btn btn-outline">
            Retomar
          </button>
        </div>
      )}

      {!isRestrictedPage && !originGranted && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-warn/40 bg-warn/12 px-3 py-2.5">
          <p className="text-[13px] text-ink-2 min-w-0 flex-1 basis-60">
            Ative o monitoramento em <strong className="font-semibold text-ink">{host || 'este site'}</strong>{' '}
            para ver o <code className="num text-xs">dataLayer</code>, os cookies de marketing e
            hits bloqueados.
          </p>
          <button type="button" onClick={onRequestPermission} className="btn btn-ink">
            Ativar neste site
          </button>
        </div>
      )}
    </header>
  );
}
