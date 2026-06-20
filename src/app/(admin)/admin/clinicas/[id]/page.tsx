import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { BillingBadge, ClinicStatusBadge } from '../../_components/badges';
import { guardAdminAccess } from '../../_lib/guard';
import { formatBRLCents, formatDateTime, formatNumber, formatUSD } from '../../_lib/format';
import { clinicRepository } from '../../_lib/repositories/clinics.repo';
import { ExportAuditForm } from './export-form';
import { ImpersonateForm } from './impersonate-form';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
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
    <>
      <PageHeader
        title={c.general.nome}
        description={`/${c.general.slug}`}
        actions={<ImpersonateForm clinicId={c.general.id} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados gerais</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Row label="Status" value={<ClinicStatusBadge status={c.general.status} />} />
            <Row label="CNPJ" value={c.general.cnpj ?? '—'} />
            <Row label="Timezone" value={c.general.timezone} />
            <Row label="Criada em" value={formatDateTime(c.general.createdAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plano &amp; Billing</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Row label="Plano" value={c.plan ? `${c.plan.name} (${c.plan.code})` : '—'} />
            <Row
              label="Preço"
              value={c.plan ? `${formatBRLCents(c.plan.priceCents)} / ${c.plan.cycle}` : '—'}
            />
            <Row label="Billing" value={<BillingBadge status={c.billing.billingStatus} />} />
            <Row label="Faturas abertas" value={formatNumber(c.billing.openInvoices)} />
            <Row label="Em atraso" value={formatNumber(c.billing.overdue)} />
            <Row label="Dunning stage" value={formatNumber(c.billing.dunningStage)} />
            <Row label="Último pagamento" value={formatDateTime(c.billing.lastPaidAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Uso de IA (30 dias)</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Row label="Conversas" value={formatNumber(c.aiUsage.conversations)} />
            <Row label="Mensagens" value={formatNumber(c.aiUsage.messages)} />
            <Row label="Tokens" value={formatNumber(c.aiUsage.tokens)} />
            <Row label="Custo Gemini" value={formatUSD(c.aiUsage.costUsd)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrações</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
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
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Usuários ({c.users.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {c.users.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum usuário.</p>
          ) : (
            <div className="divide-y divide-border">
              {c.users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{u.nome}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="gray">{u.role}</Badge>
                    {u.ativo ? null : <Badge tone="red">inativo</Badge>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Últimas auditorias</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {c.recentAudit.length === 0 ? (
            <p className="text-sm text-fg-subtle">Sem eventos.</p>
          ) : (
            <div className="divide-y divide-border">
              {c.recentAudit.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-fg-subtle">{formatDateTime(a.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Exportar auditoria (PDF + SHA256)</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <ExportAuditForm clinicId={c.general.id} />
        </CardContent>
      </Card>
    </>
  );
}
