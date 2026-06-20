import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { PROMPT_HASH, PROMPT_VERSION } from '@/contexts/ai-agent/prompts/system';
import { env } from '@/lib/env';

import { guardAdminAccess } from '../_lib/guard';
import { formatBRLCents } from '../_lib/format';
import { configRepository } from '../_lib/repositories/config.repo';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}

export default async function ConfigPage() {
  await guardAdminAccess();
  const plans = await configRepository.getPlans();

  const templates = [
    { key: 'lembrete (confirmação)', name: env.META_TEMPLATE_CONFIRMATION_REMINDER_ID ?? '— não configurado' },
    { key: 'dunning (cobrança)', name: env.META_TEMPLATE_DUNNING_FRIENDLY_ID ?? '— não configurado' },
    { key: 'follow-up (retorno)', name: env.META_TEMPLATE_FOLLOWUP_RETURN_ID ?? '— não configurado' },
  ];

  return (
    <>
      <PageHeader title="Configurações" description="Somente leitura. Nada editável por aqui." />

      <Card>
        <CardHeader>
          <CardTitle>Planos</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {plans.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum plano cadastrado.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {plans.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-xs text-fg-subtle">{p.code}</span>
                    {p.ativo ? <Badge tone="green">ativo</Badge> : <Badge tone="gray">inativo</Badge>}
                  </div>
                  <div className="text-sm">
                    Preços:{' '}
                    {p.prices.length === 0
                      ? '—'
                      : p.prices.map((pr) => `${formatBRLCents(pr.amountCents)}/${pr.cycle}`).join(' · ')}
                  </div>
                  <div className="text-sm text-fg-muted">
                    Limites:{' '}
                    {p.limits.length === 0
                      ? '—'
                      : p.limits.map((l) => `${l.metric}=${l.value}`).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Prompt da IA</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Row label="Versão" value={PROMPT_VERSION} />
            <Row label="Hash (SHA256)" value={`${PROMPT_HASH.slice(0, 16)}…`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Templates (Meta)</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Row label="Idioma" value={env.META_TEMPLATE_LANG} />
            {templates.map((t) => (
              <Row key={t.key} label={t.key} value={t.name} />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
