import type { ReactNode } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Icon } from '@/components/painel/icons';

import { PROMPT_HASH, PROMPT_VERSION, RAW_TEMPLATE } from '@/contexts/ai-agent/prompts/system';
import { env } from '@/lib/env';

import { guardAdminAccess } from '../_lib/guard';

export const dynamic = 'force-dynamic';

type SP = { tab?: string };

const SUBS = [
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
  const tab = SUBS.some((s) => s.id === rawTab) ? rawTab! : 'prompt';

  const templates = [
    { label: 'Lembrete (confirmação)', desc: 'Disparado antes da consulta', icon: 'clock', id: env.META_TEMPLATE_CONFIRMATION_REMINDER_ID },
    { label: 'Dunning (cobrança)', desc: 'Sequência de cobrança amigável', icon: 'wallet', id: env.META_TEMPLATE_DUNNING_FRIENDLY_ID },
    { label: 'Follow-up (retorno)', desc: 'Convite de retorno pós-consulta', icon: 'refresh', id: env.META_TEMPLATE_FOLLOWUP_RETURN_ID },
  ];

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Plataforma <span className="sep">›</span> <b>Configurações</b>
          </>
        }
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
