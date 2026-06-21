import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';

import { BillingBadge, ClinicStatusBadge } from '../../_components/badges';
import { guardAdminAccess } from '../../_lib/guard';
import { formatBRLCents, formatDateTime, formatNumber, formatUSD } from '../../_lib/format';
import { clinicRepository } from '../../_lib/repositories/clinics.repo';
import { ExportAuditForm } from './export-form';
import { ImpersonateForm } from './impersonate-form';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default async function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await guardAdminAccess();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const c = await clinicRepository.getDetail(id);
  if (!c) notFound();

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/admin/clinicas">Clínicas</Link> <span className="sep">›</span>{' '}
            <b>{c.general.nome}</b>
          </>
        }
        title={c.general.nome}
        description={`/${c.general.slug}`}
        actions={<ImpersonateForm clinicId={c.general.id} />}
      />

      <div className="cols-2">
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Dados gerais</h4>
          </div>
          <div className="px-5 py-3">
            <Row label="Status" value={<ClinicStatusBadge status={c.general.status} />} />
            <Row label="CNPJ" value={c.general.cnpj ?? '—'} />
            <Row label="Timezone" value={c.general.timezone} />
            <Row label="Criada em" value={formatDateTime(c.general.createdAt)} />
          </div>
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Plano &amp; pagamentos</h4>
          </div>
          <div className="px-5 py-3">
            <Row label="Plano" value={c.plan ? `${c.plan.name} (${c.plan.code})` : '—'} />
            <Row
              label="Preço"
              value={c.plan ? `${formatBRLCents(c.plan.priceCents)} / ${c.plan.cycle}` : '—'}
            />
            <Row label="Cobrança" value={<BillingBadge status={c.billing.billingStatus} />} />
            <Row label="Faturas abertas" value={formatNumber(c.billing.openInvoices)} />
            <Row label="Em atraso" value={formatNumber(c.billing.overdue)} />
            <Row label="Estágio de cobrança" value={formatNumber(c.billing.dunningStage)} />
            <Row label="Último pagamento" value={formatDateTime(c.billing.lastPaidAt)} />
          </div>
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Uso de IA</h4>
            <span className="sub">últimos 30 dias</span>
          </div>
          <div className="px-5 py-3">
            <Row label="Conversas" value={formatNumber(c.aiUsage.conversations)} />
            <Row label="Mensagens" value={formatNumber(c.aiUsage.messages)} />
            <Row label="Tokens" value={formatNumber(c.aiUsage.tokens)} />
            <Row label="Custo Gemini" value={formatUSD(c.aiUsage.costUsd)} />
          </div>
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Integrações</h4>
          </div>
          <div className="px-5 py-3">
            <Row
              label="WhatsApp (Meta)"
              value={
                <Badge tone={c.integrations.whatsapp === 'connected' ? 'green' : c.integrations.whatsapp === 'pending' ? 'amber' : 'gray'}>
                  {c.integrations.whatsapp}
                </Badge>
              }
            />
            <Row
              label="Asaas"
              value={
                <Badge tone={c.integrations.asaas === 'linked' ? 'green' : 'gray'}>
                  {c.integrations.asaas}
                </Badge>
              }
            />
          </div>
        </div>
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Usuários</h4>
          <span className="sub">{c.users.length}</span>
        </div>
        {c.users.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Nenhum usuário.</p>
        ) : (
          <div className="px-5 py-2">
            {c.users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0"
              >
                <span className="font-medium">{u.nome}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="gray">{u.role}</Badge>
                  {u.ativo ? null : <Badge tone="red">inativo</Badge>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Últimas auditorias</h4>
          <span className="sub">90 dias</span>
        </div>
        {c.recentAudit.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Sem eventos.</p>
        ) : (
          <div className="px-5 py-2">
            {c.recentAudit.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0"
              >
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-xs text-fg-subtle">{formatDateTime(a.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Exportar auditoria</h4>
          <span className="sub">PDF + SHA256</span>
        </div>
        <div className="px-5 py-4">
          <ExportAuditForm clinicId={c.general.id} />
        </div>
      </div>
    </div>
  );
}
