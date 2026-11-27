import type { Metadata } from 'next';
import { Banknote, Bot, CircleCheck, MessageCircle, Database, TriangleAlert } from 'lucide-react';
import type { ComponentType } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/ui/cn';

import type { HealthStatus } from '../_lib/dto';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { healthService } from '../_lib/services/health.service';

export const metadata: Metadata = { title: 'Saúde da plataforma' };

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
const PROVIDER_ICON: Record<string, ComponentType<{ className?: string }>> = {
  supabase: Database,
  gemini: Bot,
  meta: MessageCircle,
  asaas: Banknote,
};
const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: 'Operacional',
  degraded: 'Degradado',
  down: 'Indisponível',
};
const TONE: Record<HealthStatus, 'green' | 'amber' | 'red'> = {
  ok: 'green',
  degraded: 'amber',
  down: 'red',
};
/** Ponto de status com halo — DS v2 §status. */
const DOT: Record<HealthStatus, string> = {
  ok: 'bg-success-500 shadow-[0_0_0_3px_color-mix(in_oklch,var(--success-500)_16%,transparent)]',
  degraded:
    'bg-warning-500 shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning-500)_16%,transparent)]',
  down: 'bg-danger-500 shadow-[0_0_0_3px_color-mix(in_oklch,var(--danger-500)_16%,transparent)]',
};

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
    <>
      <PageHeader
        crumbs={[{ label: 'Plataforma' }, { label: 'Saúde' }]}
        title="Saúde da plataforma"
        description="Status em tempo real das integrações críticas e da infraestrutura."
      />

      {/* Banner de estado geral */}
      <div
        className={cn(
          'flex items-start gap-3 rounded-(--r-md) border px-4 py-3.5',
          worst === 'ok' &&
            'border-[color-mix(in_oklch,var(--success-500)_26%,transparent)] bg-success-50 dark:bg-[color-mix(in_oklch,var(--success-500)_14%,transparent)]',
          worst === 'degraded' &&
            'border-[color-mix(in_oklch,var(--warning-500)_32%,transparent)] bg-warning-50 dark:bg-[color-mix(in_oklch,var(--warning-500)_16%,transparent)]',
          worst === 'down' &&
            'border-[color-mix(in_oklch,var(--danger-500)_26%,transparent)] bg-danger-50 dark:bg-[color-mix(in_oklch,var(--danger-500)_14%,transparent)]',
        )}
      >
        {worst === 'ok' ? (
          <CircleCheck aria-hidden="true" className="mt-px size-5 text-success-600" />
        ) : (
          <TriangleAlert
            aria-hidden="true"
            className={cn(
              'mt-px size-5',
              worst === 'down' ? 'text-danger-600' : 'text-warning-700',
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <b className="text-(length:--fs-sm) font-semibold">
            {worst === 'ok'
              ? 'Tudo operacional'
              : worst === 'degraded'
                ? 'Degradação parcial'
                : 'Incidente em andamento'}
          </b>
          <span className="block text-(length:--fs-sm) text-fg-muted">
            {worst === 'ok'
              ? `${reports.length} serviços monitorados, todos saudáveis.`
              : `${incidents.length} serviço(s) com atenção · ${incidents
                  .map((i) => PROVIDER_LABEL[i.provider] ?? i.provider)
                  .join(', ')}.`}
          </span>
        </div>
        <span className="font-mono text-(length:--fs-2xs) text-fg-subtle">atualizado agora</span>
      </div>

      {/* Serviços — lista vertical compacta (pedido do founder: sem grade de ícones) */}
      <Card className="mt-(--sp-4)">
        <ul className="flex flex-col">
          {reports.map((r) => {
            const IconCmp = PROVIDER_ICON[r.provider] ?? Database;
            return (
              <li
                key={r.provider}
                className="flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', DOT[r.status])}
                />
                <IconCmp className="size-4 shrink-0 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <b className="block text-(length:--fs-sm) leading-tight font-semibold">
                    {PROVIDER_LABEL[r.provider] ?? r.provider}
                  </b>
                  <span className="block truncate text-(length:--fs-xs) text-fg-subtle">
                    {PROVIDER_DESC[r.provider] ?? r.reason}
                  </span>
                </div>
                <span className="font-mono text-(length:--fs-xs) text-fg-muted">
                  {r.latencyMs != null ? `${r.latencyMs} ms` : '—'}
                </span>
                <span className="hidden font-mono text-(length:--fs-2xs) text-fg-subtle sm:block">
                  ok {formatDateTime(r.lastSuccessAt)}
                </span>
                <Badge tone={TONE[r.status]} dot>
                  {STATUS_LABEL[r.status]}
                </Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Incidentes ativos */}
      <Card className="mt-(--sp-4)">
        <div className="flex items-center justify-between border-b border-border px-(--card-pad) py-3">
          <h4 className="text-(length:--fs-sm) font-semibold">Incidentes ativos</h4>
          <span className="text-(length:--fs-xs) text-fg-subtle">serviços com atenção</span>
        </div>
        {incidents.length === 0 ? (
          <p className="px-(--card-pad) py-4 text-sm text-fg-subtle">
            Nenhum incidente — todos os serviços operacionais. 🎉
          </p>
        ) : (
          <ul className="flex flex-col">
            {incidents.map((r) => (
              <li
                key={r.provider}
                className="flex items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', DOT[r.status])}
                />
                <div className="min-w-0 flex-1">
                  <b className="block text-(length:--fs-sm) font-semibold">
                    {PROVIDER_LABEL[r.provider] ?? r.provider}
                  </b>
                  <span className="block text-(length:--fs-xs) text-fg-muted">{r.reason}</span>
                </div>
                <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-fg-subtle">
        Verde = operacional · Amarelo = degradado/indeterminado · Vermelho = indisponível.
      </p>
    </>
  );
}
