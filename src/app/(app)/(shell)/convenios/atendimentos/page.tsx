import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import {
  COVERAGE_STATUS_LABELS,
  getSchedulingInsuranceOptions,
  listUpcomingInsuranceAppointments,
} from '@/contexts/health-insurance/config-queries';

import { ConveniosHeader, conveniosAccess } from '../_lib/access';
import { CoverageForm } from '../_lib/config-ui';

export const metadata: Metadata = { title: 'Atendimentos de convênio' };

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  ready: 'green',
  incomplete: 'amber',
  pending_authorization: 'amber',
  authorization_recorded: 'blue',
  authorization_denied: 'red',
};

/**
 * Próximos atendimentos de convênio (P3.3/P5.2): a recepção vê, antes do paciente
 * chegar, o que falta na cobertura (carteirinha, contrato, autorização) e registra ou
 * corrige ali — inclusive de atendimento remarcado. A cobertura congela quando o
 * atendimento começa; o atendimento clínico nunca é bloqueado por pendência administrativa.
 */
export default async function AtendimentosConvenioPage() {
  const access = await conveniosAccess('Atendimentos de convênio');
  if (!access.ok) return access.view;
  // Matriz I.2 + D-3 (opção B): a recepção registra a cobertura de qualquer atendimento; sem visão
  // ampla, a lista já vem só com os atendimentos da própria pessoa, e ela registra só neles (a
  // action confere a posse de novo no servidor).
  const canEditAgenda = access.rights.operate || !access.rights.broad;
  const [rows, options] = await Promise.all([
    listUpcomingInsuranceAppointments(access.clinicId, access.scope),
    canEditAgenda ? getSchedulingInsuranceOptions(access.clinicId) : Promise.resolve(null),
  ]);
  const insurers = options?.insurers ?? [];

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title="Atendimentos de convênio"
        description="Próximos atendimentos de convênio e o que falta na cobertura antes de o paciente chegar."
        crumbs={[{ label: 'Atendimentos' }]}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento de convênio agendado"
          description="Na Agenda, escolha a forma de atendimento “Convênio” ao criar o atendimento."
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Procedimento</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead>O que falta</TableHead>
                {canEditAgenda ? <TableHead aria-label="Ações" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.appointmentId} data-testid="insurance-appointment" data-coverage={r.coverage?.status ?? 'none'}>
                  <TableCell className="tabular-nums">
                    {new Date(r.scheduledAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}
                    <div className="text-fg-muted">{r.doctorName ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    {r.patientId ? (
                      <Link href={`/convenios/carteirinhas?paciente=${r.patientId}`} className="hover:underline">
                        {r.patientName ?? 'Paciente'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{r.procedureName ?? '—'}</TableCell>
                  <TableCell>
                    {r.coverage ? (
                      <>
                        <Badge tone={TONE[r.coverage.status] ?? 'gray'}>{COVERAGE_STATUS_LABELS[r.coverage.status] ?? r.coverage.status}</Badge>
                        <div className="text-fg-muted">
                          {r.coverage.insurerName}
                          {r.coverage.last4 ? ` · final ${r.coverage.last4}` : ''}
                        </div>
                      </>
                    ) : (
                      <Badge tone="red">Sem cobertura</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.coverage ? (
                      r.coverage.issues.length === 0 ? (
                        <span className="text-fg-muted">Nada</span>
                      ) : (
                        <ul className="list-disc pl-4 text-(length:--fs-sm)">
                          {r.coverage.issues.map((i) => (
                            <li key={i.code}>{i.message}</li>
                          ))}
                        </ul>
                      )
                    ) : (
                      <span className="text-(length:--fs-sm)">Registre operadora e carteirinha; sem isso a guia não é gerada.</span>
                    )}
                  </TableCell>
                  {canEditAgenda ? (
                    <TableCell>
                      {r.patientId ? (
                        <CoverageForm
                          appointmentId={r.appointmentId}
                          patientId={r.patientId}
                          insurers={insurers}
                          label={r.coverage ? 'Corrigir cobertura' : 'Registrar cobertura'}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
