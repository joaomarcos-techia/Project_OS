/**
 * P3.3 e P5.2 (agenda): faixa "Convênios de hoje" para a AGENDA oficial (tela do PR #56, montada
 * pelo patch docs/convenios/patches/56-agenda-p33-p52.patch). Server Component: lê os atendimentos
 * de convênio do dia com a cobertura e as pendências pré-consulta (carteirinha ausente ou vencida,
 * autorização faltando, perfil TISS incompleto), e leva a quem resolve: `/convenios/atendimentos`.
 *
 * Conforme o perfil (D-3, opção B): quem só vê Convênios (a médica) vê só os próprios atendimentos;
 * sem acesso a Convênios, nada aparece. A carteirinha só aparece mascarada (4 últimos); nenhum valor.
 */
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { COVERAGE_STATUS_LABELS, listUpcomingInsuranceAppointments } from '@/contexts/health-insurance/config-queries';
import { isInsuranceSchemaInstalled } from '@/contexts/health-insurance/queries';
import { conveniosRights, guideScopeFor } from '@/contexts/health-insurance/rights';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { getCurrentUser } from '@/lib/auth/tenant-context';

const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const timeIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export async function AgendaInsuranceStrip() {
  const user = await getCurrentUser();
  if (!user?.clinicId) return null;
  const rights = conveniosRights(user.permissions);
  if (!rights.view || !(await isInsuranceSchemaInstalled(user.clinicId))) return null;
  const tz = await getClinicTimezone(user.clinicId);
  const today = dayIn(new Date().toISOString(), tz);
  const all = await listUpcomingInsuranceAppointments(user.clinicId, guideScopeFor(rights, user.userId), 60);
  const items = all.filter((a) => a.scheduledAt && dayIn(a.scheduledAt, tz) === today);
  if (items.length === 0) return null;
  const pending = items.filter((a) => !a.coverage || a.coverage.status !== 'ready' || a.coverage.issues.length > 0);
  return (
    <section
      aria-label="Convênios de hoje"
      data-insurance-strip
      className="mb-(--sp-3) flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3) text-(length:--fs-sm)"
    >
      <p>
        <Badge tone={pending.length > 0 ? 'amber' : 'green'}>Convênios de hoje</Badge>{' '}
        {pending.length > 0
          ? `${pending.length} de ${items.length} atendimento(s) com pendência antes da consulta.`
          : `${items.length} atendimento(s), sem pendência antes da consulta.`}
      </p>
      <ul aria-label="Atendimentos de convênio de hoje" className="flex flex-col gap-(--sp-1)">
        {items.map((a) => {
          const isPending = pending.includes(a);
          const issue = a.coverage?.issues[0]?.message ?? (a.coverage ? null : 'Sem cobertura de convênio registrada.');
          return (
            <li key={a.appointmentId} data-appointment={a.appointmentId} data-pending={isPending ? 'yes' : 'no'}>
              <span className="tabular-nums">{timeIn(a.scheduledAt, tz)}</span> · {a.patientName ?? 'Paciente'} ·{' '}
              {a.coverage ? (
                <>
                  {a.coverage.insurerName}
                  {a.coverage.last4 ? <span className="tabular-nums"> ••••{a.coverage.last4}</span> : null} ·{' '}
                  {COVERAGE_STATUS_LABELS[a.coverage.status] ?? a.coverage.status}
                </>
              ) : (
                'Convênio'
              )}
              {isPending && issue ? <span className="text-fg-muted"> — {issue}</span> : null}
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && rights.operate ? (
        <Link href="/convenios/atendimentos" className="self-start font-medium text-(--primary-active) hover:underline">
          Resolver as pendências em Convênios
        </Link>
      ) : pending.length > 0 ? (
        <span className="text-fg-muted">A recepção resolve as pendências em Convênios.</span>
      ) : null}
    </section>
  );
}
