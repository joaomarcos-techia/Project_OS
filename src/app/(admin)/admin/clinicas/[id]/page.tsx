import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/painel/icons';

import { BillingBadge, ClinicStatusBadge } from '../../_components/badges';
import { guardAdminAccess } from '../../_lib/guard';
import { formatBRLCents, formatDate, formatDateTime, formatNumber, formatUSD } from '../../_lib/format';
import { clinicRepository } from '../../_lib/repositories/clinics.repo';
import { ExportAuditForm } from './export-form';
import { ImpersonateForm } from './impersonate-form';

export const dynamic = 'force-dynamic';

type IntegState = 'connected' | 'attention' | 'none';

function initialsOf(name: string): string {
  return (
    name
      .replace(/[^A-Za-zÀ-ú ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '??'
  );
}

/** Tom do ponto de auditoria por ação (mesma semântica da aba Auditoria). */
function auditDot(action: string): 'green' | 'amber' | 'red' {
  if (action.includes('refund') || action.includes('delete') || action.includes('overdue')) return 'red';
  if (action.includes('update') || action.includes('reschedule') || action.includes('sign')) return 'amber';
  return 'green';
}

function Kv({ k, value, empty }: { k: string; value: ReactNode; empty?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <span className={`kv-v${empty ? ' empty' : ''}`}>{value}</span>
    </div>
  );
}

function IntegRow({ label, icon, state }: { label: string; icon: string; state: IntegState }) {
  const map: Record<IntegState, { tone: 'green' | 'amber' | 'gray'; txt: string; sub: string; ico: string }> = {
    connected: { tone: 'green', txt: 'Conectado', sub: 'Webhook ativo', ico: 'green' },
    attention: { tone: 'amber', txt: 'Atenção', sub: 'Verificar credenciais', ico: 'amber' },
    none: { tone: 'gray', txt: 'Não conectado', sub: 'Configurar para ativar', ico: '' },
  };
  const m = map[state];
  return (
    <div className="integ-row">
      <span className={`st-ico ${m.ico}`} style={{ width: 36, height: 36, borderRadius: 9 }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="integ-id">
        <b>{label}</b>
        <span>{m.sub}</span>
      </div>
      <Badge tone={m.tone}>{m.txt}</Badge>
    </div>
  );
}

export default async function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await guardAdminAccess();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const c = await clinicRepository.getDetail(id);
  if (!c) notFound();

  const initials = initialsOf(c.general.nome);
  const active = c.general.status === 'active';
  const lastActivity = c.recentAudit[0]?.timestamp ?? null;
  const waState: IntegState =
    c.integrations.whatsapp === 'connected' ? 'connected' : c.integrations.whatsapp === 'pending' ? 'attention' : 'none';
  const asaasState: IntegState = c.integrations.asaas === 'linked' ? 'connected' : 'none';
  const priceLabel = c.plan ? formatBRLCents(c.plan.priceCents) : null;

  return (
    <div>
      <Link href="/admin/clinicas" className="back-link">
        <Icon name="chevR" size={15} />
        <span>Voltar para Clínicas</span>
      </Link>

      {/* ======================== HEADER DE PERFIL ======================== */}
      <div className="phead surface-card" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ph-cover" aria-hidden="true" />
        <div className="ph-main">
          <div className="ph-photo">
            <span
              className="avatar xl"
              data-name={initials}
              style={{ background: 'linear-gradient(135deg,var(--primary-500),var(--accent-500))' }}
            />
            {active ? <span className="ph-online" /> : null}
          </div>
          <div className="ph-id">
            <div className="ph-name-row">
              <h4 className="ph-name">{c.general.nome}</h4>
              <ClinicStatusBadge status={c.general.status} />
              {c.plan ? <Badge tone="blue">{c.plan.code}</Badge> : null}
            </div>
            <div className="ph-meta">
              <span className="mono">/{c.general.slug}</span>
              <span className="sep">·</span>
              <span className="mono">CNPJ {c.general.cnpj ?? '—'}</span>
              <span className="sep">·</span>
              <span className="mono">{c.general.timezone}</span>
              <span className="sep">·</span>
              <span>criada em {formatDate(c.general.createdAt)}</span>
            </div>
          </div>
          <div className="ph-actions">
            <Link href="/admin/billing" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Icon name="wallet" size={15} />
              Ver faturas
            </Link>
            <ImpersonateForm clinicId={c.general.id} />
          </div>
        </div>

        {c.billing.overdue > 0 ? (
          <div className="ph-alert">
            <span className="ph-al-ico">
              <Icon name="alert" size={18} sw={2} />
            </span>
            <div>
              <b>Fatura em atraso</b>{' '}
              <span className="ph-al-d">
                — estágio {c.billing.dunningStage} de cobrança · cobrança automática em curso.
              </span>
            </div>
          </div>
        ) : null}

        <div className="ph-stats">
          <div className="ph-stat">
            <span className="phs-l">MRR</span>
            <span className="phs-v">{priceLabel ?? '—'}</span>
          </div>
          <div className="ph-stat">
            <span className="phs-l">Usuários</span>
            <span className="phs-v">{c.users.length}</span>
          </div>
          <div className="ph-stat">
            <span className="phs-l">Conversas · 30d</span>
            <span className="phs-v">{formatNumber(c.aiUsage.conversations)}</span>
          </div>
          <div className="ph-stat">
            <span className="phs-l">Mensagens · 30d</span>
            <span className="phs-v">{formatNumber(c.aiUsage.messages)}</span>
          </div>
          <div className="ph-stat">
            <span className="phs-l">Última atividade</span>
            <span className="phs-v">{lastActivity ? formatDateTime(lastActivity) : '—'}</span>
          </div>
        </div>
      </div>

      {/* ======================== DADOS + PLANO ======================== */}
      <div className="cols-2">
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Dados gerais</h4>
          </div>
          <div className="kv-list">
            <Kv k="Status" value={<ClinicStatusBadge status={c.general.status} />} />
            <Kv k="Slug" value={<span className="mono">/{c.general.slug}</span>} />
            <Kv k="CNPJ" value={c.general.cnpj ?? '—'} empty={!c.general.cnpj} />
            <Kv k="Timezone" value={<span className="mono">{c.general.timezone}</span>} />
            <Kv k="Criada em" value={formatDate(c.general.createdAt)} />
          </div>
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Plano &amp; pagamentos</h4>
            <span className="sub">via Asaas</span>
          </div>
          <div className="kv-list">
            <Kv
              k="Plano"
              value={c.plan ? <Badge tone="blue">{c.plan.code}</Badge> : '—'}
              empty={!c.plan}
            />
            <Kv
              k="Preço"
              value={priceLabel ? `${priceLabel} / ${c.plan!.cycle}` : '—'}
              empty={!priceLabel}
            />
            <Kv k="Situação" value={<BillingBadge status={c.billing.billingStatus} />} />
            <Kv k="Faturas abertas" value={formatNumber(c.billing.openInvoices)} />
            <Kv
              k="Em atraso"
              value={
                c.billing.overdue > 0 ? (
                  <span style={{ color: 'var(--danger-600)', fontWeight: 600 }}>{c.billing.overdue}</span>
                ) : (
                  '0'
                )
              }
            />
            <Kv
              k="Estágio de cobrança"
              value={c.billing.dunningStage > 0 ? c.billing.dunningStage : '—'}
              empty={c.billing.dunningStage === 0}
            />
            <Kv
              k="Último pagamento"
              value={c.billing.lastPaidAt ? formatDateTime(c.billing.lastPaidAt) : '—'}
              empty={!c.billing.lastPaidAt}
            />
          </div>
        </div>
      </div>

      {/* ======================== IA + INTEGRAÇÕES ======================== */}
      <div className="cols-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="panel">
          <h4>
            Uso de IA <span className="sub" style={{ marginLeft: 'auto' }}>últimos 30 dias</span>
          </h4>
          {c.aiUsage.conversations === 0 && c.aiUsage.messages === 0 ? (
            <div className="empty-mini">
              <Icon name="ai" size={26} sw={1.6} />
              <b>Sem atividade ainda</b>
              <span>A IA passa a registrar uso assim que o WhatsApp for conectado.</span>
            </div>
          ) : (
            <div className="ai-kpis">
              <div>
                <span className="aik-l">Conversas</span>
                <b>{formatNumber(c.aiUsage.conversations)}</b>
              </div>
              <div>
                <span className="aik-l">Mensagens</span>
                <b>{formatNumber(c.aiUsage.messages)}</b>
              </div>
              <div>
                <span className="aik-l">Tokens</span>
                <b>{formatNumber(c.aiUsage.tokens)}</b>
              </div>
              <div>
                <span className="aik-l">Custo Gemini</span>
                <b>{formatUSD(c.aiUsage.costUsd)}</b>
              </div>
            </div>
          )}
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Integrações</h4>
          </div>
          <div className="integ-list">
            <IntegRow label="WhatsApp (Meta)" icon="chat" state={waState} />
            <IntegRow label="Asaas" icon="cash" state={asaasState} />
          </div>
        </div>
      </div>

      {/* ======================== USUÁRIOS ======================== */}
      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Usuários</h4>
          <span className="sub">{c.users.length} no total</span>
        </div>
        {c.users.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Nenhum usuário.</p>
        ) : (
          <div className="table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Papel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {c.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="td-name">
                        <span className="avatar" data-name={initialsOf(u.nome)} />
                        <b style={{ fontWeight: 600 }}>{u.nome}</b>
                      </span>
                    </td>
                    <td>
                      <Badge tone="gray">{u.role}</Badge>
                    </td>
                    <td>{u.ativo ? <Badge tone="green">Ativo</Badge> : <Badge tone="gray">Inativo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======================== AUDITORIA + EXPORT ======================== */}
      <div className="cols-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Últimas auditorias</h4>
            <span className="sub">90 dias</span>
          </div>
          {c.recentAudit.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-subtle">Sem eventos.</p>
          ) : (
            <div className="listrows">
              {c.recentAudit.map((a) => (
                <div key={a.id} className="listrow">
                  <span className={`hc-dot ${auditDot(a.action)}`} style={{ margin: '0 4px' }} />
                  <div className="lr-main">
                    <b className="mono" style={{ fontSize: 12.5 }}>
                      {a.action}
                    </b>
                    <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)' }}>
                      {a.userId ? a.userId.slice(0, 8) : 'sistema'}
                    </span>
                  </div>
                  <div className="lr-end">
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {formatDateTime(a.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Exportar auditoria</h4>
            <span className="sub">PDF + SHA256</span>
          </div>
          <div style={{ padding: 'var(--sp-5)' }}>
            <ExportAuditForm clinicId={c.general.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
