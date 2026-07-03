import type { ReactNode } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Icon } from '@/components/painel/icons';

import { PROMPT_HASH, PROMPT_VERSION, RAW_TEMPLATE } from '@/contexts/ai-agent/prompts/system';
import { env } from '@/lib/env';
import { getPlatformSettingsMeta, PLATFORM_FLAG_KEYS } from '@/lib/platform-settings';
import { listAnnouncementsForAdmin } from '@/lib/platform-announcements';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime, formatNumber } from '../_lib/format';
import { jobsHealthRepository } from '../_lib/repositories/jobs-health.repo';
import { retentionRepository } from '../_lib/repositories/retention.repo';
import { AnnouncementForm, DeactivateAnnouncementButton } from './announcement-form';
import { FlagToggle } from './operation-controls';

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
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}

export default async function ConfigPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const { tab: rawTab } = await searchParams;
  const tab = SUBS.some((s) => s.id === rawTab) ? rawTab! : 'operacao';

  const flagRows =
    tab === 'operacao'
      ? await getPlatformSettingsMeta([PLATFORM_FLAG_KEYS.proactiveEnabled, PLATFORM_FLAG_KEYS.aiAgentMode])
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
              { label: 'Template lembrete', ok: Boolean(env.META_TEMPLATE_CONFIRMATION_REMINDER_ID) },
              { label: 'Template dunning', ok: Boolean(env.META_TEMPLATE_DUNNING_FRIENDLY_ID) },
              { label: 'Template followup', ok: Boolean(env.META_TEMPLATE_FOLLOWUP_RETURN_ID) },
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
              { label: 'Upstash (rate limit)', ok: Boolean(env.UPSTASH_REDIS_REST_URL) && Boolean(env.UPSTASH_REDIS_REST_TOKEN) },
              { label: 'Crypto master key', ok: Boolean(env.CRYPTO_MASTER_KEY_V1) },
              { label: 'Impersonation secret', ok: Boolean(env.IMPERSONATION_SECRET) },
              { label: 'Login hash pepper', ok: Boolean(env.LOGIN_HASH_PEPPER) },
            ],
          },
        ]
      : [];

  const templates = [
    { label: 'Lembrete (confirmação)', desc: 'Disparado antes da consulta', icon: 'clock', id: env.META_TEMPLATE_CONFIRMATION_REMINDER_ID },
    { label: 'Dunning (cobrança)', desc: 'Sequência de cobrança amigável', icon: 'wallet', id: env.META_TEMPLATE_DUNNING_FRIENDLY_ID },
    { label: 'Follow-up (retorno)', desc: 'Convite de retorno pós-consulta', icon: 'refresh', id: env.META_TEMPLATE_FOLLOWUP_RETURN_ID },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Plataforma' }, { label: 'Configurações' }]}
        title="Configurações da plataforma"
        description="Prompt do sistema e templates — versionados em código (somente leitura no MVP)."
      />

      <nav className="subtabs">
        {SUBS.map((s) => (
          <Link key={s.id} href={`/admin/config?tab=${s.id}`} className={`subtab${tab === s.id ? ' active' : ''}`}>
            {s.label}
          </Link>
        ))}
      </nav>

      {tab === 'operacao' ? (
        <>
          <div className="cardblock">
            <div className="cardblock-head">
              <h4>Kill-switches operacionais</h4>
              <span className="sub">efeito em até ~30s</span>
            </div>
            <div className="listrows">
              <div className="listrow">
                <span className="st-ico" style={{ width: 34, height: 34, borderRadius: 8 }}>
                  <Icon name="send" size={16} />
                </span>
                <div className="lr-main">
                  <b>Jobs proativos</b>
                  <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                    Lembrete, dunning e followup. Desligado: nenhuma mensagem proativa sai.
                    {proactiveRow ? ` · alterado ${formatDateTime(proactiveRow.updatedAt.toISOString())}` : ' · default'}
                  </span>
                </div>
                <div className="lr-end" style={{ gap: 10 }}>
                  <Badge tone={proactiveEnabled ? 'green' : 'red'}>{proactiveEnabled ? 'Ligado' : 'Desligado'}</Badge>
                  <FlagToggle
                    flagKey={PLATFORM_FLAG_KEYS.proactiveEnabled}
                    on={proactiveEnabled}
                    valueWhenOn={true}
                    valueWhenOff={false}
                    label="Alternar jobs proativos"
                  />
                </div>
              </div>

              <div className="listrow">
                <span className="st-ico" style={{ width: 34, height: 34, borderRadius: 8 }}>
                  <Icon name="ai" size={16} />
                </span>
                <div className="lr-main">
                  <b>Agente de IA ativo</b>
                  <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                    Desligado: responde só “um atendente já te retorna” (sem custo Gemini).
                    {aiRow ? ` · alterado ${formatDateTime(aiRow.updatedAt.toISOString())}` : ' · default'}
                  </span>
                </div>
                <div className="lr-end" style={{ gap: 10 }}>
                  <Badge tone={aiMode === 'normal' ? 'green' : 'amber'}>{aiMode === 'normal' ? 'Normal' : 'Fallback'}</Badge>
                  <FlagToggle
                    flagKey={PLATFORM_FLAG_KEYS.aiAgentMode}
                    on={aiMode === 'normal'}
                    valueWhenOn={'normal'}
                    valueWhenOff={'fallback_only'}
                    label="Alternar agente de IA"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="alert info" style={{ marginTop: 'var(--sp-4)' }}>
            <span className="al-ico">
              <Icon name="shield" size={17} sw={1.9} />
            </span>
            <div>
              <b>Ação auditada</b>
              <p>Toda alteração de flag é registrada em super_admin_actions (quem, quando e o valor).</p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'saude' ? (
        <>
          <div className="cardblock">
            <div className="cardblock-head">
              <h4>Saúde dos jobs</h4>
              <span className="sub">crons internos</span>
            </div>
            <div className="listrows">
              {jobs.map((j) => (
                <div key={j.job} className="listrow">
                  <span className={`hc-dot ${j.health === 'ok' ? 'green' : j.health === 'late' ? 'red' : ''}`} />
                  <div className="lr-main">
                    <b>{j.label}</b>
                    <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                      {j.cadence}
                      {j.lastRunAt ? ` · último ${formatDateTime(j.lastRunAt)}` : ' · nunca executou'}
                    </span>
                  </div>
                  <div className="lr-end">
                    <Badge tone={j.health === 'ok' ? 'green' : j.health === 'late' ? 'red' : 'gray'}>
                      {j.health === 'ok' ? 'Em dia' : j.health === 'late' ? 'Atrasado' : 'Sem registro'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {retention ? (
            <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
              <div className="cardblock-head">
                <h4>Retenção &amp; partições</h4>
              </div>
              <div className="px-5 py-3">
                {retention.partitions.map((p) => (
                  <KV
                    key={p.parent}
                    label={p.parent}
                    value={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {p.count} partições · cobre +{p.monthsAhead} mês(es)
                        {p.monthsAhead < 1 ? <Badge tone="amber">criar partição</Badge> : null}
                        {p.defaultCount > 0 ? <Badge tone="red">default {p.defaultCount}</Badge> : null}
                      </span>
                    }
                  />
                ))}
                <KV
                  label="Idempotency keys vencidas"
                  value={
                    retention.idempotencyExpired > 0 ? (
                      <Badge tone="amber">{formatNumber(retention.idempotencyExpired)} a limpar</Badge>
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
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'broadcast' ? (
        <>
          <div className="cardblock">
            <div className="cardblock-head">
              <h4>Novo aviso</h4>
              <span className="sub">exibido no topo de todas as clínicas</span>
            </div>
            <div className="px-5 py-4">
              <AnnouncementForm />
            </div>
          </div>

          <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
            <div className="cardblock-head">
              <h4>Avisos ativos</h4>
              <span className="sub">{announcements.length}</span>
            </div>
            {announcements.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">Nenhum aviso ativo.</p>
            ) : (
              <div className="listrows">
                {announcements.map((a) => (
                  <div key={a.id} className="listrow">
                    <span className={`hc-dot ${a.level === 'warning' ? 'amber' : ''}`} />
                    <div className="lr-main">
                      <b style={{ fontWeight: 500 }}>{a.title || a.message}</b>
                      <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                        {a.title ? `${a.message} · ` : ''}
                        {a.level === 'warning' ? 'Atenção' : 'Informativo'} · publicado {formatDateTime(a.createdAt)}
                        {a.endsAt ? ` · expira ${formatDateTime(a.endsAt)}` : ''}
                      </span>
                    </div>
                    <div className="lr-end">
                      <DeactivateAnnouncementButton id={a.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="alert info" style={{ marginTop: 'var(--sp-4)' }}>
            <span className="al-ico">
              <Icon name="shield" size={17} sw={1.9} />
            </span>
            <div>
              <b>Ação auditada</b>
              <p>Publicar/desativar aviso é registrado em super_admin_actions. O texto é exibido como texto puro (sem HTML).</p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'integracoes' ? (
        <>
          {integrations.map((grp, i) => (
            <div key={grp.group} className="cardblock" style={i === 0 ? undefined : { marginTop: 'var(--sp-4)' }}>
              <div className="cardblock-head">
                <h4>{grp.group}</h4>
              </div>
              <div className="listrows">
                {grp.items.map((it) => (
                  <div key={it.label} className="listrow">
                    <div className="lr-main">
                      <b>{it.label}</b>
                    </div>
                    <div className="lr-end">
                      <Badge tone={it.ok ? 'green' : 'gray'}>{it.ok ? 'Configurado' : 'Pendente'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="alert info" style={{ marginTop: 'var(--sp-4)' }}>
            <span className="al-ico">
              <Icon name="lock" size={17} sw={1.9} />
            </span>
            <div>
              <b>Somente presença</b>
              <p>Mostra apenas se a chave está configurada — nunca o valor. Prompt da IA: {PROMPT_VERSION}.</p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'prompt' ? (
        <>
          <div className="cardblock" style={{ overflow: 'hidden' }}>
            <div className="cardblock-head">
              <h4>Prompt do sistema · global</h4>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge tone="gray">somente leitura</Badge>
                <span className="sub">{PROMPT_VERSION}</span>
              </span>
            </div>
            <pre className="prompt-block">{RAW_TEMPLATE}</pre>
          </div>
          <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
            <div className="cardblock-head">
              <h4>Integridade</h4>
            </div>
            <div className="px-5 py-3">
              <KV label="Versão" value={PROMPT_VERSION} />
              <KV label="Hash (SHA256)" value={`${PROMPT_HASH.slice(0, 24)}…`} />
            </div>
          </div>
          <div className="alert info" style={{ marginTop: 'var(--sp-4)' }}>
            <span className="al-ico">
              <Icon name="edit" size={17} sw={1.9} />
            </span>
            <div>
              <b>Edição via código</b>
              <p>O prompt é alterado por pull request e revisão. Mudanças ficam rastreadas no histórico de deploy.</p>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'emails' ? (
        <>
          <div className="cardblock">
            <div className="cardblock-head">
              <h4>Templates (Meta WhatsApp)</h4>
              <span className="sub">idioma {env.META_TEMPLATE_LANG}</span>
            </div>
            <div className="listrows">
              {templates.map((t) => (
                <div key={t.label} className="listrow">
                  <span className="st-ico" style={{ width: 34, height: 34, borderRadius: 8 }}>
                    <Icon name={t.icon} size={16} />
                  </span>
                  <div className="lr-main">
                    <b>{t.label}</b>
                    <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
                      {t.desc}
                    </span>
                  </div>
                  <div className="lr-end">
                    {t.id ? <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.id}</span> : null}
                    <Badge tone={t.id ? 'green' : 'gray'}>{t.id ? 'Configurado' : 'Pendente'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="alert info" style={{ marginTop: 'var(--sp-4)' }}>
            <span className="al-ico">
              <Icon name="lock" size={17} sw={1.9} />
            </span>
            <div>
              <b>Templates aprovados pela Meta</b>
              <p>Os IDs vêm das variáveis de ambiente e são aplicados por deploy. O envio usa o template aprovado no idioma configurado.</p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
