import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PanelCard } from '@/components/ui/panel-card';
import {
  getPatientMemberships,
  hasOwnAppointmentWithPatient,
  MEMBERSHIP_STATUS_LABELS,
  searchPatientsForCards,
} from '@/contexts/health-insurance/config-queries';

import { ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { MembershipActions, NewMembershipForm } from '../_lib/config-ui';

export const metadata: Metadata = { title: 'Carteirinhas' };

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Carteirinhas dos pacientes (P3.1/P3.2; R44). O número fica cifrado: a lista mostra o
 * final; o completo sai só por "Ver número", com finalidade e auditoria. Substituir,
 * desativar e trocar a preferencial nunca apagam: a carteirinha antiga fica no histórico
 * e as guias feitas com ela não mudam.
 */
export default async function CarteirinhasPage({ searchParams }: { searchParams: Promise<{ q?: string; paciente?: string }> }) {
  const sp = await searchParams;
  const access = await conveniosAccess('Carteirinhas');
  if (!access.ok) return access.view;
  const q = (sp.q ?? '').slice(0, 80);
  const patientId = sp.paciente && UUID.test(sp.paciente) ? sp.paciente : null;
  // Matriz I.2 + D-3 (opção B): sem visão ampla (a médica), só existem aqui os pacientes com
  // atendimento dela: a busca vem filtrada e a carteirinha de outro paciente é "não encontrado".
  const own = access.rights.broad ? null : access.userId;
  const allowed = !patientId || own === null || (await hasOwnAppointmentWithPatient(access.clinicId, own, patientId));
  const [hits, selected] = await Promise.all([
    q.trim().length >= 2 ? searchPatientsForCards(access.clinicId, q, own) : Promise.resolve([]),
    patientId && allowed ? getPatientMemberships(access.clinicId, patientId) : Promise.resolve(null),
  ]);
  // A recepção opera em qualquer paciente; sem operar Convênios, só no paciente com quem a pessoa
  // tem atendimento (já conferido acima). A action confere de novo no servidor.
  const canEditCards = access.rights.operate || (selected !== null && own !== null);

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title="Carteirinhas"
        description="Vincule a carteirinha do paciente à operadora e ao plano. O número fica cifrado; aparece só o final."
        crumbs={[{ label: 'Carteirinhas' }]}
      />

      <PanelCard title="Paciente" regionLabel="Buscar paciente" className="mb-(--sp-4)">
        <form method="get" className="flex flex-wrap items-end gap-(--sp-2)" role="search">
          <Field label="Nome do paciente" htmlFor="cards-q" className="min-w-0 flex-1">
            <Input id="cards-q" name="q" defaultValue={q} placeholder="Mínimo 2 letras" autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
        {q.trim().length >= 2 ? (
          hits.length === 0 ? (
            <p className="mt-(--sp-3) text-(length:--fs-sm) text-fg-muted">
              Nenhum paciente com esse nome. <Link href="/pacientes?novo=1" className="underline">Cadastrar paciente</Link>
            </p>
          ) : (
            <ul className="mt-(--sp-3) flex flex-col divide-y divide-border" data-testid="cards-patient-hits">
              {hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-(--sp-2) py-(--sp-2)">
                  <Link href={`/convenios/carteirinhas?paciente=${h.id}`} className="font-medium hover:underline">
                    {h.nome}
                  </Link>
                  <span className="text-(length:--fs-sm) text-fg-muted">{h.activeCards} carteirinha(s) ativa(s)</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </PanelCard>

      {patientId && !selected ? <Alert variant="warning">Paciente não encontrado nesta clínica.</Alert> : null}

      {selected ? (
        <PanelCard title={selected.patient.nome} regionLabel="Carteirinhas do paciente" className="mb-(--sp-4)">
          {canEditCards ? (
            <div className="mb-(--sp-3)">
              <NewMembershipForm patientId={selected.patient.id} insurers={selected.insurers} />
            </div>
          ) : (
            <p className="mb-(--sp-3) text-(length:--fs-sm) text-fg-muted">Seu perfil vê as carteirinhas; cadastrar e alterar é da recepção ou da profissional que atende o paciente.</p>
          )}
          {selected.cards.length === 0 ? (
            <EmptyState title="Nenhuma carteirinha" description="Cadastre a carteirinha para o atendimento de convênio sair sem pendência." />
          ) : (
            <ul className="flex flex-col divide-y divide-border" data-testid="patient-cards">
              {selected.cards.map((c) => (
                <li key={c.id} className="flex flex-col gap-(--sp-2) py-(--sp-3)" data-testid="patient-card" data-status={c.status} data-last4={c.last4}>
                  <div className="flex flex-wrap items-center gap-(--sp-2)">
                    <span className="font-medium">{c.insurerName}</span>
                    <span className="font-mono text-(length:--fs-sm)">•••• {c.last4}</span>
                    <Badge tone={c.status === 'active' ? 'green' : 'gray'}>{MEMBERSHIP_STATUS_LABELS[c.status] ?? c.status}</Badge>
                    {c.isPreferred ? <Badge tone="blue">Preferencial</Badge> : null}
                    {c.insurerStatus !== 'active' ? <Badge tone="amber">Operadora não ativa</Badge> : null}
                  </div>
                  <div className="text-(length:--fs-sm) text-fg-muted">
                    {c.planName ?? 'Plano não informado'} · {c.holderKind === 'dependente' ? 'Dependente' : 'Titular'} · validade{' '}
                    {c.validUntil ? shortDate(c.validUntil) : 'não informada'} · cadastrada em {shortDate(c.createdAt)}
                  </div>
                  {canEditCards ? <MembershipActions card={c} insurer={selected.insurers.find((i) => i.id === c.insurerId)} /> : null}
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      ) : !q ? (
        <EmptyState title="Escolha um paciente" description="Busque pelo nome para ver e cadastrar as carteirinhas." />
      ) : null}
    </>
  );
}
