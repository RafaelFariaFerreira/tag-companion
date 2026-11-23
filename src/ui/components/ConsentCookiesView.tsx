import { Check, Minus, X } from 'lucide-react';
import type { ConsentValue, TabSession } from '@/shared/types';
import { CONSENT_KEYS } from '@/core/consent';

interface ConsentCookiesViewProps {
  session: TabSession;
  maskPii: boolean;
}

const CONSENT_LABELS: Record<(typeof CONSENT_KEYS)[number], string> = {
  ad_storage: 'Armazenamento de anúncios',
  analytics_storage: 'Armazenamento de analytics',
  ad_user_data: 'Dados de usuário para ads',
  ad_personalization: 'Personalização de anúncios',
};

function ConsentStatus({ value }: { value: ConsentValue }) {
  if (value === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
        granted
      </span>
    );
  }
  if (value === 'denied') {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-error">
        <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
        denied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted">
      <Minus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      desconhecido
    </span>
  );
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatCookieValue(value: string, maskPii: boolean): string {
  if (!maskPii) return value;
  if (value.length <= 12) return '***';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function ConsentCookiesView({ session, maskPii }: ConsentCookiesViewProps) {
  const { consent, consentHistory, cookies } = session;

  return (
    <div className="p-3 space-y-3 @3xl:p-4">
      <section className="panel" aria-labelledby="consent-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 pt-3 pb-2">
          <h2 id="consent-title" className="text-[15px] text-ink">
            Consent Mode v2
          </h2>
          <dl className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
            {consent.gcs && (
              <div className="flex gap-1">
                <dt>gcs</dt>
                <dd className="num text-ink-2">{consent.gcs}</dd>
              </div>
            )}
            {consent.gcd && (
              <div className="flex gap-1">
                <dt>gcd</dt>
                <dd className="num text-ink-2">{consent.gcd}</dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt>fonte</dt>
              <dd className="text-ink-2">{consent.source}</dd>
            </div>
          </dl>
        </div>

        <dl className="grid grid-cols-1 border-t border-rule @xl:grid-cols-2">
          {CONSENT_KEYS.map((key, i) => (
            <div
              key={key}
              className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${
                i > 0 ? 'border-t border-rule' : ''
              } ${i === 1 ? '@xl:border-t-0 @xl:border-l' : ''} ${i === 3 ? '@xl:border-l' : ''}`}
            >
              <div className="min-w-0">
                <dt className="num text-[13px] text-ink">{key}</dt>
                <dd className="text-xs text-muted">{CONSENT_LABELS[key]}</dd>
              </div>
              <ConsentStatus value={consent[key]} />
            </div>
          ))}
        </dl>

        {consentHistory.length > 0 && (
          <div className="border-t border-rule px-3.5 py-3">
            <h3 className="label mb-1.5">Histórico de mudanças</h3>
            <ol className="space-y-1">
              {consentHistory.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
                  <span className="num text-xs text-muted">{formatClock(ev.timestamp)}</span>
                  <span className="tag">{ev.source}</span>
                  <span className="num min-w-0 text-xs text-ink-2">
                    {ev.changedKeys
                      .map((k) => `${k}: ${ev.previous[k]} → ${ev.current[k]}`)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="panel overflow-hidden" aria-labelledby="cookies-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 pt-3 pb-2">
          <h2 id="cookies-title" className="text-[15px] text-ink">
            Cookies de marketing <span className="num text-muted">{cookies.length}</span>
          </h2>
          <span className="num text-xs text-muted">_ga, _gcl_aw, _fbp, _fbc, hubspotutk, _clck…</span>
        </div>

        {cookies.length === 0 ? (
          <p className="border-t border-rule px-3.5 py-8 text-center text-[13px] text-muted">
            Nenhum cookie de marketing detectado ainda nesta página.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-rule">
            <table className="w-full text-left text-[13px]">
              <thead className="text-xs text-muted">
                <tr className="border-b border-rule">
                  <th scope="col" className="px-3.5 py-2 font-medium whitespace-nowrap">Cookie</th>
                  <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">Vendor</th>
                  <th scope="col" className="hidden px-3 py-2 font-medium whitespace-nowrap @2xl:table-cell">Valor</th>
                  <th scope="col" className="hidden px-3 py-2 font-medium whitespace-nowrap @lg:table-cell">Criado às</th>
                  <th scope="col" className="px-3.5 py-2 font-medium whitespace-nowrap">Consentimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {cookies.map((ck) => (
                  <tr key={ck.id} className="row">
                    <td className="px-3.5 py-2 align-top">
                      <div className="num text-ink">{ck.name}</div>
                      <div className="num text-[11px] text-muted">{ck.domain}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-ink-2">{ck.vendorName}</td>
                    <td className="hidden max-w-[200px] truncate px-3 py-2 align-top num text-xs text-ink-2 @2xl:table-cell">
                      {formatCookieValue(ck.value, maskPii)}
                    </td>
                    <td className="hidden px-3 py-2 align-top num text-xs text-muted @lg:table-cell">
                      {formatClock(ck.createdAt)}
                    </td>
                    <td className="px-3.5 py-2 align-top">
                      {ck.createdBeforeConsent ? (
                        <span className="text-xs font-medium text-error">Antes do consentimento</span>
                      ) : (
                        <span className="num text-xs text-muted">
                          ads {ck.consentAtCreation.ad_storage}, analytics{' '}
                          {ck.consentAtCreation.analytics_storage}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
