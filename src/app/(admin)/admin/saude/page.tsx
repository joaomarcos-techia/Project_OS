import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { HealthBadge } from '../_components/badges';
import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { healthService } from '../_lib/services/health.service';

// Probe ativo a cada render; não cacheia entre requests.
export const dynamic = 'force-dynamic';

const PROVIDER_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  gemini: 'Gemini (IA)',
  meta: 'Meta (WhatsApp)',
  asaas: 'Asaas (Billing)',
};

export default async function SaudePage() {
  await guardAdminAccess();
  const reports = await healthService.check();

  return (
    <>
      <PageHeader
        title="Saúde"
        description="Disponibilidade dos provedores (probe ativo + último sucesso real)."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.provider}>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
                <HealthBadge status={r.status} />
              </div>
              <p className="text-sm text-fg-muted">{r.reason}</p>
              <div className="flex items-center justify-between text-xs text-fg-subtle">
                <span>{r.latencyMs != null ? `${r.latencyMs} ms` : 'sem latência'}</span>
                <span>último sucesso: {formatDateTime(r.lastSuccessAt)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-fg-subtle">
        Verde = operacional · Amarelo = instável/indeterminado · Vermelho = fora do ar.
      </p>
    </>
  );
}
