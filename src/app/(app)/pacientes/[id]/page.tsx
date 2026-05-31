/**
 * /pacientes/[id] — detail + edit + delete. THE decryption happens here via
 * getPatientWithDecryptedFields (the single decrypt point). RLS + key derivation
 * make a cross-tenant id both unreadable and undecryptable.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { getPatientWithDecryptedFields } from '@/contexts/patient/queries';

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

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{p.nome}</h1>
        <Link href="/pacientes" className="text-sm underline">
          Voltar
        </Link>
      </div>

      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">CPF</dt>
        <dd className="font-mono">{p.cpf}</dd>
        <dt className="font-medium">Telefone</dt>
        <dd className="font-mono">{p.telefone ?? '—'}</dd>
        <dt className="font-medium">E-mail</dt>
        <dd className="font-mono">{p.email}</dd>
      </dl>

      <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">Editar</h2>
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
        }}
      />

      <div className="mt-8 border-t border-gray-200 pt-4">
        <DeletePatientForm id={p.id} />
      </div>

      <LgpdActions id={p.id} />
    </main>
  );
}
