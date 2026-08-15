/**
 * /pacientes/[id] — HUB do paciente: Dados | Prontuários em abas (?tab=…),
 * sem navegar de tela. THE decryption happens here via
 * getPatientWithDecryptedFields (the single decrypt point). RLS + key derivation
 * make a cross-tenant id both unreadable and undecryptable.
 */
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { listProntuariosByPatient } from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import {
  getPatientWithDecryptedFields,
  getPrincipalAddress,
  listPatientRelationships,
} from '@/contexts/patient/queries';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/ui/cn';

import { updatePatientForm } from '../actions';
import { PatientForm } from '../patient-form';
import { DeletePatientForm } from './delete-form';
import { LgpdActions } from './lgpd-actions';
import { PatientDeathForm } from './patient-death-form';
import { PatientRelationshipsCard } from './patient-relationships-card';
import { NovoProntuarioButton } from './prontuarios/novo-prontuario-button';

export const dynamic = 'force-dynamic';

type Tab = 'dados' | 'prontuarios';

/** Abas do hub — server-rendered (o estado ativo vem dos searchParams). */
function HubTabs({
  patientId,
  active,
  canViewProntuario,
}: {
  patientId: string;
  active: Tab;
  canViewProntuario: boolean;
}) {
  const tab = (t: Tab, label: string) => (
    <Link
      href={`/pacientes/${patientId}?tab=${t}`}
      aria-current={active === t ? 'page' : undefined}
      className={cn(
        'relative px-3.5 py-2.5 text-(length:--fs-sm) font-medium transition-colors duration-(--dur-fast)',
        'after:absolute after:right-2 after:-bottom-px after:left-2 after:h-0.5 after:bg-primary after:transition-opacity',
        active === t
          ? 'text-primary after:opacity-100'
          : 'text-fg-muted after:opacity-0 hover:text-fg',
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav
      className="mb-(--sp-5) flex gap-0.5 border-b border-border"
      aria-label="Seções do paciente"
    >
      {tab('dados', 'Dados')}
      {/* AUTHZ-003 — sem `view:prontuario` a aba não é oferecida. O gate real
          está no render do conteúdo abaixo; esconder o link só evita prometer
          uma ação proibida. */}
      {canViewProntuario ? tab('prontuarios', 'Prontuários') : null}
    </nav>
  );
}

export default async function PacienteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  // AUTHZ-001 — antes de `getPatientWithDecryptedFields`, que é O ponto de
  // decifragem: sem gate, um deny de `view:patient` ainda entregava CPF.
  const gate = await pageGate([PERMISSIONS.VIEW_PATIENT]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Pacientes', href: '/pacientes' }]}
        title="Paciente"
        description="Seu perfil não tem permissão para ver dados de pacientes. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const { clinicId, user } = gate;
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  // F-11: validate the route param is a UUID before touching the DB / decrypt.
  // RLS + key derivation already prevent cross-tenant IDOR; this normalizes
  // malformed ids to a clean 404 instead of an unexpected query/error path.
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) notFound();
  const p = await getPatientWithDecryptedFields(clinicId, parsedId.data);
  if (!p) notFound();
  if (p.mergedIntoPatientId) redirect(`/pacientes/${p.mergedIntoPatientId}`);
  if (p.deletedAt) notFound();

  // AUTHZ-003 — o deep-link `?tab=prontuarios` não pode virar leitura clínica
  // só porque a URL foi digitada. Sem a permission, a aba não existe.
  const canViewProntuario = user.isSuperAdmin
    ? user.aal === 'aal2'
    : user.permissions.includes(PERMISSIONS.VIEW_PRONTUARIO);
  const tab: Tab = rawTab === 'prontuarios' && canViewProntuario ? 'prontuarios' : 'dados';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pacientes', href: '/pacientes' }, { label: p.nome }]}
        title={p.nome}
        actions={
          <Link href="/pacientes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Voltar
          </Link>
        }
      />

      {p.obitoEm ? (
        <div className="mb-4 rounded-(--card-radius) border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
          Falecimento registrado em {new Date(`${p.obitoEm}T12:00:00`).toLocaleDateString('pt-BR')}.
          Operacoes futuras estao bloqueadas.
        </div>
      ) : null}

      <HubTabs patientId={p.id} active={tab} canViewProntuario={canViewProntuario} />

      {tab === 'dados' ? <DadosTab clinicId={clinicId} patient={p} /> : null}
      {tab === 'prontuarios' ? (
        <ProntuariosTab clinicId={clinicId} patientId={p.id} deceased={p.obitoEm != null} />
      ) : null}
    </>
  );
}

async function DadosTab({
  clinicId,
  patient: p,
}: {
  clinicId: string;
  patient: NonNullable<Awaited<ReturnType<typeof getPatientWithDecryptedFields>>>;
}) {
  const [endereco, relationships] = await Promise.all([
    getPrincipalAddress(clinicId, p.id),
    listPatientRelationships(clinicId, p.id),
  ]);
  return (
    <div className="flex flex-col gap-(--sp-4)">
      <Card>
        <div className="border-b border-border px-(--card-pad) py-3.5">
          <h4 className="text-(length:--fs-sm) font-semibold">Dados do paciente</h4>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-(--card-pad) text-sm">
          <dt className="font-medium text-fg-muted">CPF</dt>
          <dd className="font-mono">{p.cpf}</dd>
          <dt className="font-medium text-fg-muted">Telefone</dt>
          <dd className="font-mono">{p.telefone ?? '—'}</dd>
          <dt className="font-medium text-fg-muted">E-mail</dt>
          <dd className="font-mono">{p.email}</dd>
          <dt className="font-medium text-fg-muted">Endereço</dt>
          <dd>
            {endereco
              ? [
                  [endereco.logradouro, endereco.complemento].filter(Boolean).join(', '),
                  [endereco.cidade, endereco.estado].filter(Boolean).join('/'),
                  endereco.cep ? `CEP ${endereco.cep}` : null,
                ]
                  .filter(Boolean)
                  .join(' — ')
              : '—'}
          </dd>
        </dl>
      </Card>

      <Card className="p-(--card-pad)">
        <h4 className="mb-4 text-(length:--fs-sm) font-semibold">Editar</h4>
        <PatientForm
          mode="edit"
          action={updatePatientForm}
          initial={{
            id: p.id,
            nome: p.nome,
            telefone: p.telefone,
            email: p.email,
            dataNascimento: p.dataNascimento,
            sexo: p.sexo,
            endereco,
          }}
        />
      </Card>

      <PatientRelationshipsCard patientId={p.id} relationships={relationships} />

      <Card className="p-(--card-pad)">
        <DeletePatientForm id={p.id} />
        {p.obitoEm ? null : <PatientDeathForm id={p.id} />}
        <LgpdActions id={p.id} />
      </Card>
    </div>
  );
}

async function ProntuariosTab({
  clinicId,
  patientId,
  deceased,
}: {
  clinicId: string;
  patientId: string;
  deceased: boolean;
}) {
  const list = await listProntuariosByPatient(clinicId, patientId);
  return (
    <div className="flex flex-col gap-(--sp-4)">
      {deceased ? null : (
        <div className="flex justify-end">
          <NovoProntuarioButton patientId={patientId} />
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Nenhum prontuário ainda"
          description="Crie o primeiro prontuário para registrar o atendimento."
        />
      ) : (
        <Card>
          <ul className="flex flex-col">
            {list.map((pr) => (
              <li
                key={pr.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
              >
                <Badge tone={pr.status === 'assinado' ? 'green' : 'amber'}>{pr.status}</Badge>
                <span className="text-sm text-fg-muted">
                  {new Date(pr.createdAt).toLocaleString('pt-BR')}
                </span>
                {pr.needsReturn ? (
                  <span className="text-xs text-fg-subtle">retorno em {pr.returnDays}d</span>
                ) : null}
                <span className="flex-1" />
                <Link
                  href={`/pacientes/${patientId}/prontuarios/${pr.id}`}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  {pr.status === 'assinado' ? 'Ver' : 'Editar'}
                </Link>
                {pr.status === 'rascunho' ? (
                  <Link
                    href={`/pacientes/${patientId}/prontuarios/${pr.id}?assinar=1`}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Assinar
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
