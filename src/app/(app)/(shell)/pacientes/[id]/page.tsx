/**
 * /pacientes/[id] — detail + edit + delete. THE decryption happens here via
 * getPatientWithDecryptedFields (the single decrypt point). RLS + key derivation
 * make a cross-tenant id both unreadable and undecryptable.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { getPatientWithDecryptedFields, getPrincipalAddress } from '@/contexts/patient/queries';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { updatePatientForm } from '../actions';
import { PatientForm } from '../patient-form';
import { DeletePatientForm } from './delete-form';
import { LgpdActions } from './lgpd-actions';

export const dynamic = 'force-dynamic';

export default async function PacienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { id } = await params;
  // F-11: validate the route param is a UUID before touching the DB / decrypt.
  // RLS + key derivation already prevent cross-tenant IDOR; this normalizes
  // malformed ids to a clean 404 instead of an unexpected query/error path.
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) notFound();
  const p = await getPatientWithDecryptedFields(clinicId, parsedId.data);
  if (!p || p.deletedAt) notFound();
  const endereco = await getPrincipalAddress(clinicId, parsedId.data);

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/pacientes">Pacientes</Link> <span className="sep">›</span> <b>{p.nome}</b>
          </>
        }
        title={p.nome}
        actions={
          <>
            <Link
              href={`/pacientes/${p.id}/prontuarios`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Prontuários
            </Link>
            <Link href="/pacientes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Voltar
            </Link>
          </>
        }
      />

      <div className="stack" style={{ maxWidth: 720 }}>
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Dados do paciente</h4>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 p-5 text-sm">
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
        </div>

        <div className="cardblock wrap-pad">
          <h4 className="mb-4 text-sm font-semibold">Editar</h4>
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
        </div>

        <div className="cardblock wrap-pad">
          <DeletePatientForm id={p.id} />
          <LgpdActions id={p.id} />
        </div>
      </div>
    </div>
  );
}
