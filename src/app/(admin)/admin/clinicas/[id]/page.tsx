import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/painel/icons';
import { cn } from '@/lib/ui/cn';

import { BillingBadge, ClinicStatusBadge } from '../../_components/badges';
import { guardAdminAccess } from '../../_lib/guard';
import {
  formatBRLCents,
  formatDate,
  formatDateTime,
  formatNumber,
  formatUSD,
} from '../../_lib/format';
import { clinicRepository } from '../../_lib/repositories/clinics.repo';
import { ExportAuditForm } from './export-form';
import { ImpersonateForm } from './impersonate-form';

export const metadata: Metadata = { title: 'Clínica' };

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
  if (action.includes('refund') || action.includes('delete') || action.includes('overdue'))
    return 'red';
  if (action.includes('update') || action.includes('reschedule') || action.includes('sign'))
    return 'amber';
  return 'green';
}

function Kv({ k, value, empty }: { k: string; value: ReactNode; empty?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-2.5 text-(length:--fs-sm) last:border-0">
      <dt className="min-w-0 flex-1 text-fg-muted">{k}</dt>
      <dd
        className={cn(
          'ml-auto max-w-full text-right font-mono text-(length:--fs-xs) tabular-nums',
          empty && 'text-fg-subtle',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  description,
  meta,
  children,
  flush = true,
  className,
}: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <Card role="region" aria-label={title} className={cn('min-w-0', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </CardHeader>
      <CardContent className={flush ? 'p-0 pt-(--sp-3)' : undefined}>{children}</CardContent>
    </Card>
  );
}

function IntegRow({ label, icon, state }: { label: string; icon: string; state: IntegState }) {
  const map: Record<
    IntegState,
    { tone: 'green' | 'amber' | 'gray'; txt: string; sub: string; iconClass: string }
  > = {
    connected: {
      tone: 'green',
      txt: 'Conectado',
      sub: 'Webhook ativo',
      iconClass:
        'bg-success-50 text-success-700 dark:bg-[color-mix(in_oklch,var(--success-500)_18%,transparent)] dark:text-success-200',
    },
    attention: {
      tone: 'amber',
      txt: 'Atenção',
      sub: 'Verificar credenciais',
      iconClass:
        'bg-warning-50 text-warning-700 dark:bg-[color-mix(in_oklch,var(--warning-500)_18%,transparent)] dark:text-warning-200',
    },
    none: {
      tone: 'gray',
      txt: 'Não conectado',
      sub: 'Configurar para ativar',
      iconClass: 'bg-surface-inset text-fg-subtle',
    },
  };
  const m = map[state];
  return (
    <li className="flex min-h-(--hit-target) items-center gap-3 px-(--card-pad) py-3">
      <span
        aria-hidden="true"
        className={cn('grid size-9 shrink-0 place-items-center rounded-(--r-md)', m.iconClass)}
      >
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-(length:--fs-sm) font-medium">{label}</div>
        <div className="mt-0.5 text-(length:--fs-xs) text-fg-muted">{m.sub}</div>
      </div>
      <Badge tone={m.tone}>{m.txt}</Badge>
    </li>
  );
}

function AuditDot({ tone }: { tone: 'green' | 'amber' | 'red' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mx-1 size-2 shrink-0 rounded-full',
        tone === 'green' ? 'bg-success-500' : tone === 'amber' ? 'bg-warning-500' : 'bg-danger-500',
      )}
    />
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
    c.integrations.whatsapp === 'connected'
      ? 'connected'
      : c.integrations.whatsapp === 'pending'
        ? 'attention'
        : 'none';
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
              style={{
                background: 'linear-gradient(135deg,var(--primary-500),var(--brand-accent-500))',
              }}
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
            <Link
              href="/admin/billing"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
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
      <div className="grid gap-(--sp-4) xl:grid-cols-2">
        <DetailSection title="Dados gerais" flush={false}>
          <dl>
            <Kv k="Status" value={<ClinicStatusBadge status={c.general.status} />} />
            <Kv k="Slug" value={<span className="mono">/{c.general.slug}</span>} />
            <Kv k="CNPJ" value={c.general.cnpj ?? '—'} empty={!c.general.cnpj} />
            <Kv k="Timezone" value={<span className="mono">{c.general.timezone}</span>} />
            <Kv k="Criada em" value={formatDate(c.general.createdAt)} />
          </dl>
        </DetailSection>

        <DetailSection title="Plano & pagamentos" description="Via Asaas" flush={false}>
          <dl>
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
                  <span className="font-semibold text-danger-600">{c.billing.overdue}</span>
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
          </dl>
        </DetailSection>
      </div>

      {/* ======================== IA + INTEGRAÇÕES ======================== */}
      <div className="mt-(--sp-4) grid gap-(--sp-4) xl:grid-cols-2">
        <DetailSection title="Uso de IA" description="Últimos 30 dias">
          {c.aiUsage.conversations === 0 && c.aiUsage.messages === 0 ? (
            <EmptyState
              variant="compact"
              className="border-t border-border"
              icon={<Icon name="ai" size={18} sw={1.6} />}
              title="Sem atividade ainda"
              description="A IA passa a registrar uso assim que o WhatsApp for conectado."
            />
          ) : (
            <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
              {[
                ['Conversas', formatNumber(c.aiUsage.conversations)],
                ['Mensagens', formatNumber(c.aiUsage.messages)],
                ['Tokens', formatNumber(c.aiUsage.tokens)],
                ['Custo Gemini', formatUSD(c.aiUsage.costUsd)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-(--card-bg) px-(--card-pad) py-4">
                  <span className="block font-mono text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
                    {label}
                  </span>
                  <b className="mt-1.5 block truncate font-mono text-(length:--fs-h4) font-semibold tabular-nums">
                    {value}
                  </b>
                </div>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Integrações">
          <ul className="divide-y divide-border border-t border-border">
            <IntegRow label="WhatsApp (Meta)" icon="chat" state={waState} />
            <IntegRow label="Asaas" icon="cash" state={asaasState} />
          </ul>
        </DetailSection>
      </div>

      {/* ======================== USUÁRIOS ======================== */}
      <DetailSection
        title="Usuários"
        meta={
          <span className="font-mono text-(length:--fs-xs) text-fg-subtle tabular-nums">
            {c.users.length} no total
          </span>
        }
        className="mt-(--sp-4)"
      >
        {c.users.length === 0 ? (
          <EmptyState
            variant="compact"
            className="border-t border-border"
            title="Nenhum usuário."
            description="Os usuários vinculados à clínica aparecerão nesta tabela."
          />
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
                        <b className="font-semibold">{u.nome}</b>
                      </span>
                    </td>
                    <td>
                      <Badge tone="gray">{u.role}</Badge>
                    </td>
                    <td>
                      {u.ativo ? (
                        <Badge tone="green">Ativo</Badge>
                      ) : (
                        <Badge tone="gray">Inativo</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>

      {/* ======================== AUDITORIA + EXPORT ======================== */}
      <div className="mt-(--sp-4) grid gap-(--sp-4) xl:grid-cols-2">
        <DetailSection title="Últimas auditorias" description="90 dias">
          {c.recentAudit.length === 0 ? (
            <EmptyState
              variant="compact"
              className="border-t border-border"
              title="Sem eventos."
              description="Os eventos dos últimos 90 dias aparecerão nesta lista."
            />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {c.recentAudit.map((a) => (
                <li
                  key={a.id}
                  className="flex min-h-(--hit-target) items-center gap-3 px-(--card-pad) py-3"
                >
                  <AuditDot tone={auditDot(a.action)} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-mono text-(length:--fs-xs) font-semibold">
                      {a.action}
                    </b>
                    <span className="mt-0.5 block text-(length:--fs-xs) text-fg-muted">
                      {a.userId ? a.userId.slice(0, 8) : 'sistema'}
                    </span>
                  </div>
                  <span className="ml-auto shrink-0 font-mono text-(length:--fs-2xs) text-fg-subtle tabular-nums">
                    {formatDateTime(a.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>

        <DetailSection title="Exportar auditoria" description="PDF + SHA256" flush={false}>
          <ExportAuditForm clinicId={c.general.id} />
        </DetailSection>
      </div>
    </div>
  );
}
