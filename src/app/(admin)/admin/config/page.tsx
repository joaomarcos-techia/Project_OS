import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  Clock,
  Lock,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

import { PROMPT_HASH, PROMPT_VERSION, RAW_TEMPLATE } from '@/contexts/ai-agent/prompts/system';
import { env } from '@/lib/env';
import { getPlatformSettingsMeta, PLATFORM_FLAG_KEYS } from '@/lib/platform-settings';
import { listAnnouncementsForAdmin } from '@/lib/platform-announcements';
import { cn } from '@/lib/ui/cn';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime, formatNumber } from '../_lib/format';
import { jobsHealthRepository } from '../_lib/repositories/jobs-health.repo';
import { retentionRepository } from '../_lib/repositories/retention.repo';
import { AnnouncementForm, DeactivateAnnouncementButton } from './announcement-form';
import { FlagToggle } from './operation-controls';

export const metadata: Metadata = { title: 'Configurações da plataforma' };

export const dynamic = 'force-dynamic';

type SP = { tab?: string };

const SUBS = [
  { id: 'operacao', label: 'Operação' },
  { id: 'saude', label: 'Saúde & Retenção' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'prompt', label: 'Prompt do sistema' },
  { id: 'emails', label: 'Templates de WhatsApp' },
] as const;

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-2.5 text-(length:--fs-sm) last:border-0">
      <dt className="min-w-0 flex-1 text-fg-muted">{label}</dt>
      <dd className="ml-auto max-w-full text-right font-mono text-(length:--fs-xs) tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function ConfigSection({
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

function ConfigList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-t border-border">{children}</ul>;
}

function ConfigRow({
  leading,
  title,
  description,
  trailing,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex min-h-(--hit-target) flex-wrap items-center gap-3 px-(--card-pad) py-3">
      {leading}
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-pretty text-(length:--fs-sm) font-medium">{title}</div>
        {description ? (
          <div className="mt-0.5 text-pretty text-(length:--fs-xs) text-fg-muted">
            {description}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2.5">
          {trailing}
        </div>
      ) : null}
    </li>
  );
}

function ConfigIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-(--r-md) border border-border bg-surface-inset text-fg-muted"
    >
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

function HealthDot({ tone = 'gray' }: { tone?: 'green' | 'red' | 'amber' | 'gray' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full',
        tone === 'green'
          ? 'bg-success-500'
          : tone === 'red'
            ? 'bg-danger-500'
            : tone === 'amber'
              ? // P-26 (ciclo 8): `warning-500` media 2,26:1 contra o cartão claro; o 600 é
                // tema-aware (#8a5300 / #f2c063) e passa de 3:1 nos dois temas.
                'bg-warning-600'
              : 'bg-border-strong',
      )}
    />
  );
}

export default async function ConfigPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const { tab: rawTab } = await searchParams;
  const tab = SUBS.some((s) => s.id === rawTab) ? rawTab! : 'operacao';

  const flagRows =
    tab === 'operacao'
      ? await getPlatformSettingsMeta([
          PLATFORM_FLAG_KEYS.proactiveEnabled,
          PLATFORM_FLAG_KEYS.aiAgentMode,
        ])
      : [];
  const flagByKey = new Map(flagRows.map((r) => [r.key, r]));
  const proactiveRow = flagByKey.get(PLATFORM_FLAG_KEYS.proactiveEnabled);
  const proactiveEnabled = proactiveRow ? proactiveRow.value === true : true;
  const aiRow = flagByKey.get(PLATFORM_FLAG_KEYS.aiAgentMode);
  const aiMode = typeof aiRow?.value === 'string' ? aiRow.value : 'normal';

  const jobs = tab === 'saude' ? await jobsHealthRepository.list() : [];
  const retention = tab === 'saude' ? await retentionRepository.get() : null;
  const announcements = tab === 'broadcast' ? await listAnnouncementsForAdmin() : [];

  const integrations =
    tab === 'integracoes'
      ? [
          { group: 'IA', items: [{ label: 'Gemini API key', ok: Boolean(env.GEMINI_API_KEY) }] },
          {
            group: 'WhatsApp (Meta)',
            items: [
              { label: 'App secret', ok: Boolean(env.META_APP_SECRET) },
              { label: 'Webhook verify token', ok: Boolean(env.META_WEBHOOK_VERIFY_TOKEN) },
              {
                label: 'Template lembrete',
                ok: Boolean(env.META_TEMPLATE_CONFIRMATION_REMINDER_ID),
              },
              { label: 'Template dunning', ok: Boolean(env.META_TEMPLATE_DUNNING_FRIENDLY_ID) },
              { label: 'Template followup', ok: Boolean(env.META_TEMPLATE_FOLLOWUP_RETURN_ID) },
              {
                label: 'Template recuperação de falta',
                ok: Boolean(env.META_TEMPLATE_NO_SHOW_FOLLOWUP_ID),
              },
            ],
          },
          {
            group: 'Pagamentos (Asaas)',
            items: [
              { label: 'API key', ok: Boolean(env.ASAAS_API_KEY) },
              { label: 'Webhook token', ok: Boolean(env.ASAAS_WEBHOOK_TOKEN) },
            ],
          },
          {
            group: 'Infra & segurança',
            items: [
              { label: 'CRON_SECRET', ok: Boolean(env.CRON_SECRET) },
              {
                label: 'Upstash (rate limit)',
                ok: Boolean(env.UPSTASH_REDIS_REST_URL) && Boolean(env.UPSTASH_REDIS_REST_TOKEN),
              },
              { label: 'Crypto master key', ok: Boolean(env.CRYPTO_MASTER_KEY_V1) },
              { label: 'Impersonation secret', ok: Boolean(env.IMPERSONATION_SECRET) },
              { label: 'Login hash pepper', ok: Boolean(env.LOGIN_HASH_PEPPER) },
            ],
          },
        ]
      : [];

  const templates = [
    {
      label: 'Lembrete (confirmação)',
      desc: 'Disparado antes da consulta',
      icon: Clock,
      id: env.META_TEMPLATE_CONFIRMATION_REMINDER_ID,
    },
    {
      label: 'Dunning (cobrança)',
      desc: 'Sequência de cobrança amigável',
      icon: Wallet,
      id: env.META_TEMPLATE_DUNNING_FRIENDLY_ID,
    },
    {
      label: 'Follow-up (retorno)',
      desc: 'Convite de retorno pós-consulta',
      icon: RefreshCw,
      id: env.META_TEMPLATE_FOLLOWUP_RETURN_ID,
    },
    {
      label: 'Recuperação após falta',
      desc: 'Convite operacional para remarcar no próximo dia útil',
      icon: RefreshCw,
      id: env.META_TEMPLATE_NO_SHOW_FOLLOWUP_ID,
    },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Plataforma' }, { label: 'Configurações' }]}
        title="Configurações da plataforma"
        description="Prompt do sistema e templates — versionados em código (somente leitura no MVP)."
      />

      <nav className="subtabs" aria-label="Seções de configuração">
        {SUBS.map((s) => (
          <Link
            key={s.id}
            href={`/admin/config?tab=${s.id}`}
            className={`subtab${tab === s.id ? ' active' : ''}`}
            aria-current={tab === s.id ? 'page' : undefined}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {tab === 'operacao' ? (
        <>
          <ConfigSection title="Kill-switches operacionais" description="Efeito em até ~30s">
            <ConfigList>
              <ConfigRow
                leading={<ConfigIcon icon={Send} />}
                title="Jobs proativos"
                description={
                  <>
                    Lembrete, dunning, retorno e recuperação de falta. Desligado: nenhuma mensagem
                    proativa sai.
                    {proactiveRow
                      ? ` · alterado ${formatDateTime(proactiveRow.updatedAt.toISOString())}`
                      : ' · default'}
                  </>
                }
                trailing={
                  <>
                    <Badge tone={proactiveEnabled ? 'green' : 'red'}>
                      {proactiveEnabled ? 'Ligado' : 'Desligado'}
                    </Badge>
                    <FlagToggle
                      flagKey={PLATFORM_FLAG_KEYS.proactiveEnabled}
                      on={proactiveEnabled}
                      valueWhenOn={true}
                      valueWhenOff={false}
                      label="Alternar jobs proativos"
                    />
                  </>
                }
              />

              <ConfigRow
                leading={<ConfigIcon icon={Sparkles} />}
                title="Agente de IA ativo"
                description={
                  <>
                    Desligado: responde só “um atendente já te retorna” (sem custo Gemini).
                    {aiRow
                      ? ` · alterado ${formatDateTime(aiRow.updatedAt.toISOString())}`
                      : ' · default'}
                  </>
                }
                trailing={
                  <>
                    <Badge tone={aiMode === 'normal' ? 'green' : 'amber'}>
                      {aiMode === 'normal' ? 'Normal' : 'Fallback'}
                    </Badge>
                    <FlagToggle
                      flagKey={PLATFORM_FLAG_KEYS.aiAgentMode}
                      on={aiMode === 'normal'}
                      valueWhenOn={'normal'}
                      valueWhenOff={'fallback_only'}
                      label="Alternar agente de IA"
                    />
                  </>
                }
              />
            </ConfigList>
          </ConfigSection>

          <div className="alert info mt-(--sp-4)">
            <span className="al-ico">
              <ShieldCheck aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
            </span>
            <div>
              <b>Ação auditada</b>
              <p>
                Toda alteração de flag é registrada em super_admin_actions (quem, quando e o valor).
              </p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'saude' ? (
        <>
          <ConfigSection title="Saúde dos jobs" description="Crons internos">
            {jobs.length === 0 ? (
              <EmptyState
                variant="compact"
                className="border-t border-border"
                title="Nenhum job monitorado."
                description="Os jobs configurados aparecerão nesta lista."
              />
            ) : (
              <ConfigList>
                {jobs.map((j) => (
                  <ConfigRow
                    key={j.job}
                    leading={
                      <HealthDot
                        tone={j.health === 'ok' ? 'green' : j.health === 'late' ? 'red' : 'gray'}
                      />
                    }
                    title={j.label}
                    description={
                      <>
                        {j.cadence}
                        {j.lastRunAt
                          ? ` · último ${formatDateTime(j.lastRunAt)}`
                          : ' · nunca executou'}
                      </>
                    }
                    trailing={
                      <Badge
                        tone={j.health === 'ok' ? 'green' : j.health === 'late' ? 'red' : 'gray'}
                      >
                        {j.health === 'ok'
                          ? 'Em dia'
                          : j.health === 'late'
                            ? 'Atrasado'
                            : 'Sem registro'}
                      </Badge>
                    }
                  />
                ))}
              </ConfigList>
            )}
          </ConfigSection>

          {retention ? (
            <ConfigSection title="Retenção & partições" flush={false} className="mt-(--sp-4)">
              <dl>
                {retention.partitions.map((p) => (
                  <KV
                    key={p.parent}
                    label={p.parent}
                    value={
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {p.count} partições · cobre +{p.monthsAhead} mês(es)
                        {p.monthsAhead < 1 ? <Badge tone="amber">criar partição</Badge> : null}
                        {p.defaultCount > 0 ? (
                          <Badge tone="red">default {p.defaultCount}</Badge>
                        ) : null}
                      </span>
                    }
                  />
                ))}
                <KV
                  label="Idempotency keys vencidas"
                  value={
                    retention.idempotencyExpired > 0 ? (
                      <Badge tone="amber">
                        {formatNumber(retention.idempotencyExpired)} a limpar
                      </Badge>
                    ) : (
                      '0'
                    )
                  }
                />
                <KV
                  label="Proactive jobs"
                  value={
                    retention.proactiveByStatus.length === 0
                      ? '—'
                      : retention.proactiveByStatus.map((s) => `${s.status}: ${s.n}`).join(' · ')
                  }
                />
              </dl>
            </ConfigSection>
          ) : null}
        </>
      ) : null}

      {tab === 'broadcast' ? (
        <>
          <ConfigSection
            title="Novo aviso"
            description="Exibido no topo de todas as clínicas"
            flush={false}
          >
            <AnnouncementForm />
          </ConfigSection>

          <ConfigSection
            title="Avisos ativos"
            meta={
              <span className="font-mono text-(length:--fs-xs) text-fg-subtle tabular-nums">
                {announcements.length}
              </span>
            }
            className="mt-(--sp-4)"
          >
            {announcements.length === 0 ? (
              <EmptyState
                variant="compact"
                className="border-t border-border"
                title="Nenhum aviso ativo."
                description="Avisos publicados aparecerão nesta fila."
              />
            ) : (
              <ConfigList>
                {announcements.map((a) => (
                  <ConfigRow
                    key={a.id}
                    leading={<HealthDot tone={a.level === 'warning' ? 'amber' : 'gray'} />}
                    title={a.title || a.message}
                    description={
                      <>
                        {a.title ? `${a.message} · ` : ''}
                        {a.level === 'warning' ? 'Atenção' : 'Informativo'} · publicado{' '}
                        {formatDateTime(a.createdAt)}
                        {a.endsAt ? ` · expira ${formatDateTime(a.endsAt)}` : ''}
                      </>
                    }
                    trailing={<DeactivateAnnouncementButton id={a.id} />}
                  />
                ))}
              </ConfigList>
            )}
          </ConfigSection>

          <div className="alert info mt-(--sp-4)">
            <span className="al-ico">
              <ShieldCheck aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
            </span>
            <div>
              <b>Ação auditada</b>
              <p>
                Publicar/desativar aviso é registrado em super_admin_actions. O texto é exibido como
                texto puro (sem HTML).
              </p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'integracoes' ? (
        <>
          <div className="space-y-(--sp-4)">
            {integrations.map((grp) => (
              <ConfigSection key={grp.group} title={grp.group}>
                <ConfigList>
                  {grp.items.map((it) => (
                    <ConfigRow
                      key={it.label}
                      title={it.label}
                      trailing={
                        <Badge tone={it.ok ? 'green' : 'gray'}>
                          {it.ok ? 'Configurado' : 'Pendente'}
                        </Badge>
                      }
                    />
                  ))}
                </ConfigList>
              </ConfigSection>
            ))}
          </div>
          <div className="alert info mt-(--sp-4)">
            <span className="al-ico">
              <Lock aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
            </span>
            <div>
              <b>Somente presença</b>
              <p>
                Mostra apenas se a chave está configurada — nunca o valor. Prompt da IA:{' '}
                {PROMPT_VERSION}.
              </p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'prompt' ? (
        <>
          <ConfigSection
            title="Prompt do sistema · global"
            meta={
              <span className="flex items-center gap-2">
                <Badge tone="gray">somente leitura</Badge>
                <span className="font-mono text-(length:--fs-xs) text-fg-subtle">
                  {PROMPT_VERSION}
                </span>
              </span>
            }
            className="overflow-hidden"
          >
            <pre className="prompt-block">{RAW_TEMPLATE}</pre>
          </ConfigSection>
          <ConfigSection title="Integridade" flush={false} className="mt-(--sp-4)">
            <dl>
              <KV label="Versão" value={PROMPT_VERSION} />
              <KV label="Hash (SHA256)" value={`${PROMPT_HASH.slice(0, 24)}…`} />
            </dl>
          </ConfigSection>
          <div className="alert info mt-(--sp-4)">
            <span className="al-ico">
              <PenLine aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
            </span>
            <div>
              <b>Edição via código</b>
              <p>
                O prompt é alterado por pull request e revisão. Mudanças ficam rastreadas no
                histórico de deploy.
              </p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'emails' ? (
        <>
          <ConfigSection
            title="Templates (Meta WhatsApp)"
            description={`Idioma ${env.META_TEMPLATE_LANG}`}
          >
            <ConfigList>
              {templates.map((t) => (
                <ConfigRow
                  key={t.label}
                  leading={<ConfigIcon icon={t.icon} />}
                  title={t.label}
                  description={t.desc}
                  trailing={
                    <>
                      {t.id ? (
                        <code className="break-all font-mono text-(length:--fs-2xs) text-fg-subtle">
                          {t.id}
                        </code>
                      ) : null}
                      <Badge tone={t.id ? 'green' : 'gray'}>
                        {t.id ? 'Configurado' : 'Pendente'}
                      </Badge>
                    </>
                  }
                />
              ))}
            </ConfigList>
          </ConfigSection>
          <div className="alert info mt-(--sp-4)">
            <span className="al-ico">
              <Lock aria-hidden="true" className="size-4.5" strokeWidth={1.9} />
            </span>
            <div>
              <b>Templates aprovados pela Meta</b>
              <p>
                Os IDs vêm das variáveis de ambiente e são aplicados por deploy. O envio usa o
                template aprovado no idioma configurado.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
