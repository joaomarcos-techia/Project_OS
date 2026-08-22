/**
 * /pacientes/[id] — HUB do paciente: Dados | Prontuários em abas (?tab=…),
 * sem navegar de tela. THE decryption happens here via
 * getPatientWithDecryptedFields (the single decrypt point). RLS + key derivation
 * make a cross-tenant id both unreadable and undecryptable.
 */
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import {
  listClinicalDocumentFeed,
  listProntuariosByPatient,
  listRecentProntuariosByPatient,
} from '@/contexts/clinical/queries';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import {
  getPatientWithDecryptedFields,
  getPrincipalAddress,
  listCurrentConsentDecisions,
  listPatientRelationships,
} from '@/contexts/patient/queries';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Separator } from '@/components/ui/separator';
import { SkeletonCard } from '@/components/ui/skeleton';
import { cn } from '@/lib/ui/cn';

import { ConsentCard, type ConsentPurposeView } from './consent-card';
import { DeletePatientForm } from './delete-form';
import { LgpdActions } from './lgpd-actions';
import { PatientClinicalActivity } from './patient-clinical-activity';
import { PatientDeathForm } from './patient-death-form';
import { PatientProfileCard } from './patient-profile-card';
import { PatientRelationshipsCard } from './patient-relationships-card';
import { NovoProntuarioButton } from './prontuarios/novo-prontuario-button';

export const dynamic = 'force-dynamic';

type Tab = 'dados' | 'prontuarios';

interface PatientPageUser {
  isSuperAdmin?: boolean;
  aal?: string | null;
  permissions: readonly string[];
}

/** Um único cálculo alimenta descoberta de UI e gates de leitura desta rota. */
export function patientPageCapabilities(user: PatientPageUser) {
  // Mantém o step-up já usado nesta rota: super-admin sem AAL2 não recupera
  // capacidade por um claim de permissão eventualmente presente.
  const has = (permission: Permission) =>
    user.isSuperAdmin === true ? user.aal === 'aal2' : user.permissions.includes(permission);
  return {
    canEditPatient: has(PERMISSIONS.EDIT_PATIENT),
    canDeletePatient: has(PERMISSIONS.DELETE_PATIENT),
    canExportPatient: has(PERMISSIONS.EXPORT_PATIENT),
    canViewProntuario: has(PERMISSIONS.VIEW_PRONTUARIO),
    canCreateProntuario: has(PERMISSIONS.CREATE_PRONTUARIO),
    canSignProntuario: has(PERMISSIONS.SIGN_PRONTUARIO),
    canViewDocuments: has(PERMISSIONS.VIEW_PRESCRIPTION),
  };
}

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
        'relative shrink-0 px-3.5 py-2.5 text-(length:--fs-sm) font-medium transition-colors duration-(--dur-fast)',
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
      className="mb-(--sp-5) flex gap-0.5 overflow-x-auto border-b border-border"
      aria-label="Seções do paciente"
    >
      {tab('dados', 'Visão geral')}
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
  // LGPD-005 — mesma permissão que `recordConsent`/`revokeConsent` exigem.
  const capabilities = patientPageCapabilities(user);
  const {
    canEditPatient,
    canDeletePatient,
    canExportPatient,
    canViewProntuario,
    canCreateProntuario,
    canSignProntuario,
    canViewDocuments,
  } = capabilities;
  const tab: Tab = rawTab === 'prontuarios' && canViewProntuario ? 'prontuarios' : 'dados';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pacientes', href: '/pacientes' }, { label: p.nome }]}
        title={p.nome}
        description="Visão operacional, histórico clínico e governança do cadastro."
        actions={
          <Link
            href="/pacientes"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-(--hit-target)')}
          >
            Voltar
          </Link>
        }
      />

      {p.obitoEm ? (
        <Alert variant="danger" className="mb-4">
          Falecimento registrado em {new Date(`${p.obitoEm}T12:00:00`).toLocaleDateString('pt-BR')}.
          Operações futuras estão bloqueadas.
        </Alert>
      ) : null}

      <HubTabs patientId={p.id} active={tab} canViewProntuario={canViewProntuario} />

      {tab === 'dados' ? (
        <DadosTab
          clinicId={clinicId}
          patient={p}
          canEditPatient={canEditPatient}
          canDeletePatient={canDeletePatient}
          canExportPatient={canExportPatient}
          canViewProntuario={canViewProntuario}
          canCreateProntuario={canCreateProntuario}
          canViewDocuments={canViewDocuments}
        />
      ) : null}
      {tab === 'prontuarios' ? (
        <ProntuariosTab
          clinicId={clinicId}
          patientId={p.id}
          deceased={p.obitoEm != null}
          canCreate={canCreateProntuario}
          canSign={canSignProntuario}
        />
      ) : null}
    </>
  );
}

/**
 * LGPD-005 — catálogo apresentável das finalidades. Os `purpose` são os mesmos
 * do enum do banco e de `CONSENT_DECISIONS` no domínio; o texto vive aqui
 * porque é decisão de tela, não de contrato.
 */
const CONSENT_PURPOSES: Array<{ purpose: string; label: string; description: string }> = [
  {
    purpose: 'dados_saude',
    label: 'Tratamento de dados de saúde',
    description: 'Uso dos dados clínicos para o atendimento na clínica.',
  },
  {
    purpose: 'compartilhamento',
    label: 'Compartilhamento com terceiros',
    description: 'Envio de dados a laboratórios, convênios e demais parceiros.',
  },
  {
    purpose: 'cobranca_whatsapp',
    label: 'Cobrança por WhatsApp',
    description: 'Mensagens sobre pagamentos e pendências financeiras.',
  },
  {
    purpose: 'marketing',
    label: 'Comunicações de marketing',
    description: 'Campanhas, novidades e promoções da clínica.',
  },
  {
    purpose: 'pesquisa',
    label: 'Pesquisa e estudos',
    description: 'Uso de dados anonimizados em pesquisas clínicas.',
  },
];

export async function PatientClinicalActivityData({
  clinicId,
  patientId,
  canViewProntuario,
  canViewDocuments,
  canCreateProntuario,
  deceased,
}: {
  clinicId: string;
  patientId: string;
  canViewProntuario: boolean;
  canViewDocuments: boolean;
  canCreateProntuario: boolean;
  deceased: boolean;
}) {
  if (!canViewProntuario && !canViewDocuments) return null;

  const [prontuarios, documents] = await Promise.all([
    canViewProntuario ? listRecentProntuariosByPatient(clinicId, patientId) : Promise.resolve([]),
    canViewDocuments
      ? listClinicalDocumentFeed(clinicId, { patientId, limit: 8 })
      : Promise.resolve([]),
  ]);

  return (
    <PatientClinicalActivity
      patientId={patientId}
      records={prontuarios}
      documents={documents}
      canViewRecords={canViewProntuario}
      canViewDocuments={canViewDocuments}
      canCreateRecord={canCreateProntuario}
      deceased={deceased}
    />
  );
}

export async function DadosTab({
  clinicId,
  patient: p,
  canEditPatient,
  canDeletePatient,
  canExportPatient,
  canViewProntuario,
  canCreateProntuario,
  canViewDocuments,
}: {
  clinicId: string;
  patient: NonNullable<Awaited<ReturnType<typeof getPatientWithDecryptedFields>>>;
  canEditPatient: boolean;
  canDeletePatient: boolean;
  canExportPatient: boolean;
  canViewProntuario: boolean;
  canCreateProntuario: boolean;
  canViewDocuments: boolean;
}) {
  const [endereco, relationships, decisions] = await Promise.all([
    getPrincipalAddress(clinicId, p.id),
    listPatientRelationships(clinicId, p.id),
    listCurrentConsentDecisions(clinicId, p.id),
  ]);
  const decisionByPurpose = new Map(decisions.map((d) => [d.purpose, d]));
  const consentPurposes: ConsentPurposeView[] = CONSENT_PURPOSES.map((c) => {
    const d = decisionByPurpose.get(c.purpose);
    return {
      purpose: c.purpose,
      label: c.label,
      description: c.description,
      granted: d?.granted ?? false,
      version: d?.version ?? 0,
      recordedAt: d?.recordedAt ?? null,
    };
  });
  const hasLifecycleActions =
    canDeletePatient || canExportPatient || (canEditPatient && p.obitoEm == null);

  return (
    <div
      data-patient-layout="crm"
      className="grid items-start gap-(--sp-4) xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]"
    >
      <PatientProfileCard
        patient={{
          id: p.id,
          nome: p.nome,
          cpf: p.cpf,
          telefone: p.telefone,
          email: p.email,
          dataNascimento: p.dataNascimento,
          sexo: p.sexo,
          updatedAt: p.updatedAt,
          obitoEm: p.obitoEm,
        }}
        address={endereco}
        canEdit={canEditPatient}
      />

      <aside
        aria-label="Contexto do paciente"
        className="flex min-w-0 flex-col gap-(--sp-4) xl:col-start-2 xl:row-start-1 xl:row-span-3"
      >
        {canViewProntuario || canViewDocuments ? (
          <Suspense
            fallback={
              <div role="status" aria-label="Carregando atividade clínica">
                <SkeletonCard lines={6} />
                <span className="sr-only">Carregando atividade clínica…</span>
              </div>
            }
          >
            <PatientClinicalActivityData
              clinicId={clinicId}
              patientId={p.id}
              canViewProntuario={canViewProntuario}
              canViewDocuments={canViewDocuments}
              canCreateProntuario={canCreateProntuario}
              deceased={p.obitoEm != null}
            />
          </Suspense>
        ) : null}
        <ConsentCard patientId={p.id} purposes={consentPurposes} canEdit={canEditPatient} />
      </aside>

      <PatientRelationshipsCard
        patientId={p.id}
        relationships={relationships}
        canEdit={canEditPatient}
        className="xl:col-start-1"
      />

      {hasLifecycleActions ? (
        <Card data-patient-section="lifecycle" className="overflow-hidden xl:col-start-1">
          <div className="px-(--card-pad) py-4">
            <h2 className="text-balance text-(length:--fs-h4) font-semibold">
              Privacidade e ciclo de vida
            </h2>
            <p className="mt-1 text-pretty text-(length:--fs-xs) text-fg-muted">
              Ações restritas, auditadas e separadas da operação diária.
            </p>
          </div>
          <Separator />
          <div className="p-(--card-pad) [&>section:first-child]:mt-0 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
            {canDeletePatient ? <DeletePatientForm id={p.id} /> : null}
            {canEditPatient && !p.obitoEm ? <PatientDeathForm id={p.id} /> : null}
            <LgpdActions id={p.id} canExport={canExportPatient} canDelete={canDeletePatient} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

async function ProntuariosTab({
  clinicId,
  patientId,
  deceased,
  canCreate,
  canSign,
}: {
  clinicId: string;
  patientId: string;
  deceased: boolean;
  canCreate: boolean;
  canSign: boolean;
}) {
  const list = await listProntuariosByPatient(clinicId, patientId);
  return (
    <div className="flex flex-col gap-(--sp-4)">
      {deceased || !canCreate ? null : (
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
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'min-h-(--hit-target)',
                  )}
                >
                  {pr.status === 'assinado' || !canCreate ? 'Ver' : 'Editar'}
                </Link>
                {pr.status === 'rascunho' && canSign ? (
                  <Link
                    href={`/pacientes/${patientId}/prontuarios/${pr.id}?assinar=1`}
                    className={cn(
                      buttonVariants({ variant: 'secondary', size: 'sm' }),
                      'min-h-(--hit-target)',
                    )}
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
