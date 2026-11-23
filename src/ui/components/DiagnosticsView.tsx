import { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Diagnostic, DiagnosticSeverity, TabSession } from '@/shared/types';

interface DiagnosticsViewProps {
  session: TabSession;
  onJumpToItem: (itemId: string) => void;
}

const SEVERITY_META: Record<
  DiagnosticSeverity,
  { label: string; tone: string; Icon: typeof AlertCircle }
> = {
  high: { label: 'Alta', tone: 'text-error', Icon: AlertCircle },
  medium: { label: 'Média', tone: 'text-warn-ink', Icon: AlertTriangle },
  low: { label: 'Baixa', tone: 'text-muted', Icon: Info },
};

export function DiagnosticsView({ session, onJumpToItem }: DiagnosticsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | DiagnosticSeverity>('all');

  const highCount = session.diagnostics.filter((d) => d.severity === 'high').length;
  const mediumCount = session.diagnostics.filter((d) => d.severity === 'medium').length;
  const lowCount = session.diagnostics.filter((d) => d.severity === 'low').length;

  const visible = session.diagnostics.filter(
    (d) => severityFilter === 'all' || d.severity === severityFilter,
  );

  return (
    <div className="p-3 space-y-3 @3xl:p-4">
      <div className="seg" role="group" aria-label="Severidade">
        {(
          [
            { id: 'all', label: 'Todos', count: session.diagnostics.length },
            { id: 'high', label: 'Alta', count: highCount },
            { id: 'medium', label: 'Média', count: mediumCount },
            { id: 'low', label: 'Baixa', count: lowCount },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={severityFilter === f.id}
            onClick={() => setSeverityFilter(f.id)}
          >
            {f.label} <span className="num">{f.count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="panel px-6 py-10 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-success" aria-hidden="true" />
          <p className="mt-2 font-medium text-ink">
            {session.diagnostics.length === 0
              ? 'Nenhum problema detectado nesta sessão'
              : 'Nenhum alerta com essa severidade'}
          </p>
          {session.diagnostics.length === 0 && (
            <p className="mx-auto mt-1 max-w-[56ch] text-[13px] text-muted">
              As 9 regras automáticas (consentimento, hits perdidos, eventos sem hit, duplicidade,
              deduplicação, propriedades, PII, click IDs e scripts sem disparo) não encontraram
              alertas.
            </p>
          )}
        </div>
      ) : (
        <ol className="panel divide-y divide-rule overflow-hidden">
          {visible.map((diag) => (
            <DiagnosticRow key={diag.id} diag={diag} onJumpToItem={onJumpToItem} />
          ))}
        </ol>
      )}
    </div>
  );
}

function DiagnosticRow({
  diag,
  onJumpToItem,
}: {
  diag: Diagnostic;
  onJumpToItem: (id: string) => void;
}) {
  const meta = SEVERITY_META[diag.severity];
  const Icon = meta.Icon;

  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 px-3.5 py-3 @xl:grid-cols-[16px_minmax(0,1fr)_auto]">
      <Icon className={`mt-0.5 h-4 w-4 ${meta.tone}`} aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="max-w-none text-[14px] text-ink">{diag.title}</h3>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          <span className={`text-xs font-medium ${meta.tone}`}>Severidade {meta.label.toLowerCase()}</span>
          <span className="num text-[11px] text-muted">{diag.ruleId}</span>
        </div>
        <p className="mt-1 max-w-[80ch] text-[13px] text-ink-2">{diag.description}</p>
        <p className="mt-1.5 max-w-[80ch] text-[13px] text-muted">
          <span className="font-medium text-ink">Próximo passo:</span> {diag.recommendation}
        </p>
      </div>
      {diag.relatedItemIds.length > 0 && (
        <div className="col-start-2 mt-2 @xl:col-start-3 @xl:row-start-1 @xl:mt-0">
          <button
            type="button"
            onClick={() => onJumpToItem(diag.relatedItemIds[0])}
            className="btn btn-outline"
          >
            Inspecionar
          </button>
        </div>
      )}
    </li>
  );
}
