import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/painel/icons';

import type { HealthStatus } from '../_lib/dto';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { healthService } from '../_lib/services/health.service';

// Probe ativo a cada render; não cacheia entre requests.
export const dynamic = 'force-dynamic';

const PROVIDER_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  gemini: 'Google Gemini',
  meta: 'Meta WhatsApp',
  asaas: 'Asaas',
};
const PROVIDER_DESC: Record<string, string> = {
  supabase: 'Banco de dados e auth',
  gemini: 'Motor de IA conversacional',
  meta: 'Mensageria e webhooks',
  asaas: 'Cobrança, Pix e boletos',
};
const PROVIDER_ICON: Record<string, string> = {
  supabase: 'box',
  gemini: 'ai',
  meta: 'chat',
  asaas: 'cash',
};
const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: 'Operacional',
  degraded: 'Degradado',
  down: 'Indisponível',
};
const TONE: Record<HealthStatus, 'green' | 'amber' | 'red'> = { ok: 'green', degraded: 'amber', down: 'red' };

export default async function SaudePage() {
  await guardAdminAccess();
  const reports = await healthService.check();

  const worst: HealthStatus = reports.some((r) => r.status === 'down')
    ? 'down'
    : reports.some((r) => r.status === 'degraded')
      ? 'degraded'
      : 'ok';
  const incidents = reports.filter((r) => r.status !== 'ok');

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Plataforma <span className="sep">›</span> <b>Saúde</b>
          </>
        }
        title="Saúde da plataforma"
        description="Status em tempo real das integrações críticas e da infraestrutura."
      />

      <div className={`health-banner ${TONE[worst]}`}>
        <Icon name={worst === 'ok' ? 'check' : 'alert'} size={18} sw={2} />
        <div>
          <b>{worst === 'ok' ? 'Tudo operacional' : worst === 'degraded' ? 'Degradação parcial' : 'Incidente em andamento'}</b>
          <span>
            {worst === 'ok'
              ? `${reports.length} serviços monitorados, todos saudáveis.`
              : `${incidents.length} serviço(s) com atenção · ${incidents.map((i) => PROVIDER_LABEL[i.provider] ?? i.provider).join(', ')}.`}
          </span>
        </div>
        <span className="mono">atualizado agora</span>
      </div>

      <div className="health-grid" style={{ marginTop: 'var(--sp-4)' }}>
        {reports.map((r) => (
          <div key={r.provider} className="health-card">
            <div className="hc-top">
              <span
                className={`st-ico ${TONE[r.status]}`}
                style={{ width: 36, height: 36, borderRadius: 9 }}
              >
                <Icon name={PROVIDER_ICON[r.provider] ?? 'monitor'} size={18} />
              </span>
              <div className="hc-id">
                <b>{PROVIDER_LABEL[r.provider] ?? r.provider}</b>
                <span>{PROVIDER_DESC[r.provider] ?? r.reason}</span>
              </div>
              <span className={`hc-dot ${TONE[r.status]}`} />
            </div>
            <div className={`hc-status ${TONE[r.status]}`}>{STATUS_LABEL[r.status]}</div>
            <div className="hc-stats">
              <div>
                <span className="hc-k">Latência</span>
                <b>{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</b>
              </div>
              <div>
                <span className="hc-k">Último sucesso</span>
                <b>{formatDateTime(r.lastSuccessAt)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Incidentes ativos</h4>
          <span className="sub">serviços com atenção</span>
        </div>
        {incidents.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Nenhum incidente — todos os serviços operacionais. 🎉</p>
        ) : (
          <div className="listrows">
            {incidents.map((r) => (
              <div key={r.provider} className="listrow">
                <span className={`hc-dot ${TONE[r.status]}`} style={{ margin: '0 4px' }} />
                <div className="lr-main">
                  <b>{PROVIDER_LABEL[r.provider] ?? r.provider}</b>
                  <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                    {r.reason}
                  </span>
                </div>
                <div className="lr-end">
                  <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-fg-subtle">
        Verde = operacional · Amarelo = degradado/indeterminado · Vermelho = indisponível.
      </p>
    </div>
  );
}
