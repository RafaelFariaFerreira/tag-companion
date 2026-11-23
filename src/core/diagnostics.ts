import type { Diagnostic, ParsedHit, TabSession } from '@/shared/types';
import {
  ADS_VENDORS,
  CLICK_ID_GRACE_WINDOW_MS,
  CONVERSION_EVENT_NAMES,
  DUPLICATE_WINDOW_MS,
  EVENT_WITHOUT_HIT_WINDOW_MS,
  GA4_CONVERSION_EVENTS,
  META_CONVERSION_EVENTS,
  matchMarketingCookie,
} from '@/shared/constants';
import { detectPiiInParams } from './pii';
import { formatConsentSummary } from './consent';

function normalizeEvent(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function runDiagnostics(session: TabSession, now = Date.now()): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // 1. Tag antes do consentimento (Alta)
  for (const hit of session.hits) {
    const consent = hit.consentAtHit ?? session.consent;

    // Ads vendors firing while ad_storage is denied
    if (ADS_VENDORS.has(hit.vendorId) && consent.ad_storage === 'denied') {
      // Google Ads cookieless ping with explicit gcs=G10x is Consent Mode compliant
      const isGoogleAdsCookieless =
        hit.vendorId === 'google_ads' && hit.gcs && /^G10[01]$/i.test(hit.gcs);
      if (!isGoogleAdsCookieless) {
        diagnostics.push({
          id: `diag:consent-hit:${hit.id}`,
          ruleId: 'tag_before_consent',
          severity: 'high',
          title: 'Tag de mídia disparou antes do consentimento',
          description: `${hit.vendorName} enviou o evento "${hit.eventName}" enquanto ad_storage estava denied (${formatConsentSummary(consent)}).`,
          recommendation:
            'Configure o gatilho ou a verificação de consentimento adicional (ad_storage) no GTM ou no CMP antes de disparar este tag.',
          timestamp: hit.timestamp,
          vendorId: hit.vendorId,
          accountId: hit.accountId,
          relatedItemIds: [hit.id],
        });
      }
    }

    // Clarity or HubSpot firing while analytics_storage is denied
    if (
      (hit.vendorId === 'clarity' || hit.vendorId === 'hubspot') &&
      consent.analytics_storage === 'denied'
    ) {
      diagnostics.push({
        id: `diag:consent-analytics:${hit.id}`,
        ruleId: 'tag_before_consent',
        severity: 'high',
        title: `${hit.vendorName} disparou antes do consentimento`,
        description: `${hit.vendorName} enviou dados ("${hit.eventName}") enquanto analytics_storage estava denied (${formatConsentSummary(consent)}).`,
        recommendation:
          'Bloqueie o carregamento ou disparo até o usuário conceder analytics_storage, ou use a API de consentimento do vendor (ex: clarity("consent", false)).',
        timestamp: hit.timestamp,
        vendorId: hit.vendorId,
        accountId: hit.accountId,
        relatedItemIds: [hit.id],
      });
    }
  }

  // Marketing cookies created before consent
  for (const cookie of session.cookies) {
    if (!cookie.createdBeforeConsent) continue;
    const def = matchMarketingCookie(cookie.name);
    const reqSignal = def?.requiresConsent ?? 'ad_storage';
    diagnostics.push({
      id: `diag:consent-cookie:${cookie.id}`,
      ruleId: 'tag_before_consent',
      severity: 'high',
      title: `Cookie de marketing "${cookie.name}" criado antes do consentimento`,
      description: `O cookie ${cookie.name} (${cookie.vendorName}) foi gravado enquanto ${reqSignal} estava denied.`,
      recommendation:
        'Verifique se o script do vendor está fixo no HTML fora do controle do CMP/GTM e garanta que só inicialize após consentimento.',
      timestamp: cookie.createdAt,
      vendorId: cookie.vendorId,
      relatedItemIds: [cookie.id],
    });
  }

  // 2. Hit perdido (Alta)
  for (const hit of session.hits) {
    if (hit.status !== 'failed') continue;
    const reason = hit.error
      ? hit.error
      : typeof hit.statusCode === 'number'
        ? `HTTP ${hit.statusCode}`
        : 'erro desconhecido';

    let recommendation =
      'Verifique a aba Network e a configuração do endpoint do vendor.';
    if (hit.error?.includes('ERR_ABORTED')) {
      recommendation =
        'A página provavelmente navegou antes de o hit completar. Ative transport_type="beacon" / sendBeacon ou aguarde o callback do evento antes do redirecionamento.';
    } else if (hit.error?.includes('ERR_BLOCKED_BY_CLIENT')) {
      recommendation =
        'Bloqueado por ad blocker ou extensão do navegador. Considere tagging server-side (sGTM) em domínio próprio para reduzir perdas legítimas.';
    } else if (hit.statusCode && hit.statusCode >= 400) {
      recommendation =
        'O servidor do vendor ou sGTM rejeitou a requisição. Confira a URL do endpoint, CORS e formato do payload.';
    }

    diagnostics.push({
      id: `diag:hit-lost:${hit.id}`,
      ruleId: 'hit_lost',
      severity: 'high',
      title: `Hit perdido: ${hit.vendorName} · ${hit.eventName}`,
      description: `A requisição para ${hit.endpoint} falhou com ${reason}. No Tag Assistant este tag pode aparecer como "disparado", mas os dados não chegaram ao vendor.`,
      recommendation,
      timestamp: hit.timestamp,
      vendorId: hit.vendorId,
      accountId: hit.accountId,
      relatedItemIds: [hit.id],
    });
  }

  // 3. Evento sem hit (Alta)
  for (const ev of session.dataLayerEvents) {
    if (ev.isConsentCommand) continue;
    const norm = normalizeEvent(ev.eventName);
    if (!CONVERSION_EVENT_NAMES.has(norm)) continue;
    if (ev.correlatedHitIds.length > 0) continue;
    if (now - ev.timestamp < EVENT_WITHOUT_HIT_WINDOW_MS) continue;

    diagnostics.push({
      id: `diag:event-no-hit:${ev.id}`,
      ruleId: 'event_without_hit',
      severity: 'high',
      title: `Evento de conversão "${ev.eventName}" sem hit`,
      description: `O evento "${ev.eventName}" foi enviado ao dataLayer há mais de 5 s, mas nenhum hit de vendor foi correlacionado a ele.`,
      recommendation:
        'Confira se existe um gatilho configurado no GTM para este nome exato de evento, se há exceção bloqueando o disparo ou se o consentimento negado impediu o envio.',
      timestamp: ev.timestamp,
      relatedItemIds: [ev.id],
    });
  }

  // 4. Duplicidade (Média)
  const reportedDuplicates = new Set<string>();
  const validHits = session.hits.filter((h) => h.status !== 'failed');
  for (let i = 0; i < validHits.length; i++) {
    const a = validHits[i];
    for (let j = i + 1; j < validHits.length; j++) {
      const b = validHits[j];
      if (b.timestamp - a.timestamp > DUPLICATE_WINDOW_MS) break;
      if (a.vendorId !== b.vendorId) continue;
      if ((a.accountId ?? '') !== (b.accountId ?? '')) continue;
      if (normalizeEvent(a.eventName) !== normalizeEvent(b.eventName)) continue;

      // Skip Clarity collect heartbeats
      if (a.vendorId === 'clarity' && a.eventName === 'collect') continue;

      const pairKey = `${a.vendorId}:${a.accountId ?? ''}:${normalizeEvent(a.eventName)}:${Math.floor(a.timestamp / DUPLICATE_WINDOW_MS)}`;
      if (reportedDuplicates.has(pairKey)) continue;
      reportedDuplicates.add(pairKey);

      const mixedOrigins =
        a.origin !== 'unknown' &&
        b.origin !== 'unknown' &&
        a.origin !== b.origin;

      diagnostics.push({
        id: `diag:duplicate:${a.id}:${b.id}`,
        ruleId: 'duplicate_hit',
        severity: 'medium',
        title: `Disparo duplicado: ${a.vendorName} · ${a.eventName}`,
        description: mixedOrigins
          ? `O evento "${a.eventName}" foi enviado duas vezes para ${a.accountId || a.vendorName} em ${b.timestamp - a.timestamp} ms por origens diferentes (${a.origin} e ${b.origin}).`
          : `O evento "${a.eventName}" foi enviado duas vezes para ${a.accountId || a.vendorName} em ${b.timestamp - a.timestamp} ms.`,
        recommendation: mixedOrigins
          ? 'Remova o script fixo duplicado na página ou desative o tag correspondente no GTM.'
          : 'Verifique se o push no dataLayer ocorreu duas vezes ou se há dois tags disparando no mesmo gatilho.',
        timestamp: b.timestamp,
        vendorId: a.vendorId,
        accountId: a.accountId,
        relatedItemIds: [a.id, b.id],
      });
    }
  }

  // 5. Sem chave de deduplicação (Média)
  const hasDedupContext =
    session.hasServerSideGtm ||
    session.hits.some((h) => h.hasServerSideIndicator || Boolean(h.eventId));

  if (hasDedupContext) {
    for (const hit of session.hits) {
      if (hit.status === 'failed') continue;
      const norm = normalizeEvent(hit.eventName);
      if (
        hit.vendorId === 'meta_pixel' &&
        META_CONVERSION_EVENTS.has(norm.replace(/_/g, '')) &&
        !hit.eventId
      ) {
        diagnostics.push({
          id: `diag:dedup:${hit.id}`,
          ruleId: 'missing_dedup_key',
          severity: 'medium',
          title: `Meta Pixel "${hit.eventName}" sem chave de deduplicação (eid)`,
          description: `Há indícios de sGTM/CAPI nesta página, mas o evento "${hit.eventName}" saiu sem parâmetro eid.`,
          recommendation:
            'Envie o mesmo event_id no navegador (parâmetro eid do Pixel) e no servidor (Meta CAPI) para evitar conversões duplicadas.',
          timestamp: hit.timestamp,
          vendorId: hit.vendorId,
          accountId: hit.accountId,
          relatedItemIds: [hit.id],
        });
      } else if (
        hit.vendorId === 'ga4' &&
        GA4_CONVERSION_EVENTS.has(norm) &&
        !hit.eventId
      ) {
        diagnostics.push({
          id: `diag:dedup:${hit.id}`,
          ruleId: 'missing_dedup_key',
          severity: 'medium',
          title: `GA4 "${hit.eventName}" sem event_id`,
          description: `O evento "${hit.eventName}" foi enviado via sGTM/setup com deduplicação, mas não inclui ep.event_id.`,
          recommendation:
            'Adicione o parâmetro event_id no dataLayer e mapeie-o nos tags GA4 e CAPI para deduplicação consistente.',
          timestamp: hit.timestamp,
          vendorId: hit.vendorId,
          accountId: hit.accountId,
          relatedItemIds: [hit.id],
        });
      }
    }
  }

  // 6. Propriedade errada (Média) — multiple GA4 tids or multiple GTM containers
  const ga4Ids = new Set<string>();
  const ga4Related: string[] = [];
  for (const hit of session.hits) {
    if (hit.vendorId === 'ga4' && hit.accountId && /^G-/i.test(hit.accountId)) {
      ga4Ids.add(hit.accountId);
      ga4Related.push(hit.id);
    }
  }
  for (const script of session.scripts) {
    if (script.vendorId === 'ga4' && script.accountId && /^G-/i.test(script.accountId)) {
      ga4Ids.add(script.accountId);
      ga4Related.push(script.id);
    }
  }
  if (ga4Ids.size > 1) {
    const ids = [...ga4Ids];
    diagnostics.push({
      id: `diag:wrong-prop:ga4:${ids.sort().join(',')}`,
      ruleId: 'wrong_property',
      severity: 'medium',
      title: `Múltiplas propriedades GA4 detectadas (${ids.length})`,
      description: `Foram encontrados ${ids.length} IDs de GA4 na mesma sessão: ${ids.join(', ')}.`,
      recommendation:
        'Confirme se todas as propriedades são intencionais (ex: rollup) ou se há um Measurement ID antigo/de staging vazando em produção.',
      timestamp: now,
      vendorId: 'ga4',
      relatedItemIds: ga4Related.slice(0, 6),
    });
  }

  const gtmIds = new Set<string>();
  const gtmRelated: string[] = [];
  for (const script of session.scripts) {
    if (script.vendorId === 'gtm' && script.accountId && /^GTM-/i.test(script.accountId)) {
      gtmIds.add(script.accountId);
      gtmRelated.push(script.id);
    }
  }
  if (gtmIds.size > 1) {
    const ids = [...gtmIds];
    diagnostics.push({
      id: `diag:wrong-prop:gtm:${ids.sort().join(',')}`,
      ruleId: 'wrong_property',
      severity: 'medium',
      title: `Múltiplos containers GTM na página (${ids.length})`,
      description: `Foram carregados ${ids.length} containers GTM simultaneamente: ${ids.join(', ')}.`,
      recommendation:
        'Verifique se o segundo container é necessário; múltiplos containers aumentam risco de disparos duplicados e conflitos de dataLayer.',
      timestamp: now,
      vendorId: 'gtm',
      relatedItemIds: gtmRelated.slice(0, 6),
    });
  }

  // 7. PII na URL (Alta)
  for (const hit of session.hits) {
    const findings = detectPiiInParams(hit.rawParams, hit.url);
    if (findings.length > 0) {
      const summary = findings
        .map((f) => `${f.type === 'email' ? 'e-mail' : 'telefone'} em "${f.field}" (${f.sample})`)
        .join(', ');
      diagnostics.push({
        id: `diag:pii:${hit.id}`,
        ruleId: 'pii_in_url',
        severity: 'high',
        title: `PII detectada em ${hit.vendorName} · ${hit.eventName}`,
        description: `Dados pessoais em texto claro foram encontrados no hit: ${summary}.`,
        recommendation:
          'Remova e-mail/telefone de URLs (dl, dr) e parâmetros em texto claro. Use SHA-256 apenas nos campos dedicados de Enhanced Conversions / Advanced Matching.',
        timestamp: hit.timestamp,
        vendorId: hit.vendorId,
        accountId: hit.accountId,
        relatedItemIds: [hit.id],
      });
    }
  }

  // 8. Click ID não guardado (Baixa)
  const cookieNames = new Set(session.cookies.map((c) => c.name));
  for (const clickRecord of session.clickIds) {
    if (now - clickRecord.detectedAt < CLICK_ID_GRACE_WINDOW_MS) continue;

    if (clickRecord.gclid && !cookieNames.has('_gcl_aw')) {
      diagnostics.push({
        id: `diag:clickid:gclid:${clickRecord.detectedAt}`,
        ruleId: 'click_id_not_stored',
        severity: 'low',
        title: 'gclid presente na URL, mas cookie _gcl_aw não foi gravado',
        description: `A URL continha gclid, porém o cookie _gcl_aw não apareceu após o carregamento (${formatConsentSummary(session.consent)}).`,
        recommendation:
          'Verifique se o Conversion Linker está ativo no GTM e se ad_storage foi concedido para persistir atribuição do Google Ads.',
        timestamp: clickRecord.detectedAt,
        vendorId: 'google_ads',
        relatedItemIds: [],
      });
    }

    if (clickRecord.fbclid && !cookieNames.has('_fbc')) {
      diagnostics.push({
        id: `diag:clickid:fbclid:${clickRecord.detectedAt}`,
        ruleId: 'click_id_not_stored',
        severity: 'low',
        title: 'fbclid presente na URL, mas cookie _fbc não foi gravado',
        description: `A URL continha fbclid, porém o cookie _fbc não apareceu após o carregamento (${formatConsentSummary(session.consent)}).`,
        recommendation:
          'Verifique se o Meta Pixel inicializou corretamente e se cookies first-party estão habilitados (e permitidos pelo consentimento).',
        timestamp: clickRecord.detectedAt,
        vendorId: 'meta_pixel',
        relatedItemIds: [],
      });
    }
  }

  // 9. Carregou, não disparou (Média)
  // Group scripts by vendorId (excluding GTM container itself, which loads other tags)
  const scriptsByVendor = new Map<string, typeof session.scripts>();
  for (const script of session.scripts) {
    if (script.vendorId === 'gtm') continue;
    const list = scriptsByVendor.get(script.vendorId) ?? [];
    list.push(script);
    scriptsByVendor.set(script.vendorId, list);
  }

  const hitsByVendor = new Map<string, ParsedHit[]>();
  for (const hit of session.hits) {
    const list = hitsByVendor.get(hit.vendorId) ?? [];
    list.push(hit);
    hitsByVendor.set(hit.vendorId, list);
  }

  for (const [vendorId, scripts] of scriptsByVendor.entries()) {
    const vendorHits = hitsByVendor.get(vendorId) ?? [];
    if (vendorHits.length > 0) continue;
    const first = scripts[0];
    diagnostics.push({
      id: `diag:loaded-no-fire:${vendorId}`,
      ruleId: 'loaded_no_fire',
      severity: 'medium',
      title: `${first.vendorName} carregou, mas não disparou`,
      description: `A biblioteca ${first.scriptName} carregou na página, mas nenhum hit foi enviado. Consentimento atual: ${formatConsentSummary(session.consent)}.`,
      recommendation:
        session.consent.ad_storage === 'denied' ||
        session.consent.analytics_storage === 'denied'
          ? 'O consentimento está negado — confirme se o disparo ocorre após o aceite no banner de cookies.'
          : 'Verifique se o gatilho de inicialização/PageView está configurado corretamente ou se houve erro de JavaScript bloqueando o disparo.',
      timestamp: first.timestamp,
      vendorId: first.vendorId,
      accountId: first.accountId,
      relatedItemIds: scripts.map((s) => s.id),
    });
  }

  // Sort by severity (high -> medium -> low), then newest first
  const severityRank: Record<Diagnostic['severity'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  diagnostics.sort((a, b) => {
    const diff = severityRank[a.severity] - severityRank[b.severity];
    if (diff !== 0) return diff;
    return b.timestamp - a.timestamp;
  });

  return diagnostics;
}
