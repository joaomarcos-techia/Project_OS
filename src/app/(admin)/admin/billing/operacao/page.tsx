import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { guardAdminAccess } from '../../_lib/guard';
import { getAbacatePayOperations } from '../../_lib/repositories/abacatepay-operations.repo';
import { ReplayForm } from './replay-form';

export const dynamic = 'force-dynamic';

export default async function BillingOperationsPage() {
  await guardAdminAccess();
  const operations = await getAbacatePayOperations();
  return (
    <>
      <PageHeader
        title="Conciliação AbacatePay"
        description="Revisão operacional restrita. Uma nova leitura não substitui a comprovação do pagamento."
      />
      {!operations ? (
        <p>Operação disponível somente no ambiente Sandbox autorizado.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <PanelCard title="Fila de eventos">
            <p>
              {operations.backlog.reviews} em revisão; {operations.backlog.queued} aguardando
              processamento.
            </p>
            <p>Mais antigo: {operations.backlog.oldest?.toISOString() ?? 'nenhum'}.</p>
            <p>
              São exibidos até 50 eventos com vínculo verificável. Eventos sem vínculo ficam em
              quarentena e exigem investigação; não podem ser associados por suposição.
            </p>
            <p>
              Ausência de alertas não comprova que a varredura foi concluída. Confira o heartbeat do
              cron e os lotes adiados.
            </p>
            {operations.quarantined.length ? (
              <ul className="break-all">
                {operations.quarantined.map((row) => (
                  <li key={`${row.account_id}:${row.event_id}`}>
                    Revisão sem reprocessamento disponível: {row.event_id} · {row.event_type} ·{' '}
                    {row.outcome_code ?? 'vínculo pendente'}
                  </li>
                ))}
              </ul>
            ) : null}
          </PanelCard>
          <PanelCard title="Renovações sem comprovação local">
            <p>
              Este alerta não comprova pagamento perdido. Confira o evento original e o extrato no
              provedor. Não gere outra cobrança para investigar.
            </p>
            {!operations.renewals.length ? (
              <p>Nenhuma ocorrência registrada pelo monitor.</p>
            ) : (
              <ul className="break-all">
                {operations.renewals.map((row) => (
                  <li key={row.subscription_id}>
                    Clínica {row.clinic_id} · contrato {row.subscription_id} · fim do período{' '}
                    {row.period_end.toISOString()} · detectado {row.created_at.toISOString()}
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
          {operations.reviews.map((row) => (
            <PanelCard key={`${row.account_id}:${row.event_id}`} title={row.event_type}>
              <p className="break-all">
                Clínica {row.clinic_id} · evento {row.event_id} ·{' '}
                {row.outcome_code ?? 'revisão pendente'}
              </p>
              <p>
                {row.attempts} tentativas acumuladas; {row.replay_count}/3 autorizações nas últimas
                24 horas.
              </p>
              <ReplayForm
                accountId={row.account_id}
                eventId={row.event_id}
                clinicId={row.clinic_id}
                snapshot={row.snapshot}
                limited={row.replay_count >= 3}
              />
            </PanelCard>
          ))}
        </div>
      )}
    </>
  );
}
