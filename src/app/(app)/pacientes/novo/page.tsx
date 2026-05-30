/**
 * /pacientes/novo — create form. requireFreshPermission(create:patient) is
 * enforced inside the action; this page just renders the form.
 */
import Link from 'next/link';

import { requireUser } from '@/lib/auth/tenant-context';

import { createPatientForm } from '../actions';
import { PatientForm } from '../patient-form';

export const dynamic = 'force-dynamic';

export default async function NovoPacientePage() {
  await requireUser();
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Novo paciente</h1>
        <Link href="/pacientes" className="text-sm underline">
          Voltar
        </Link>
      </div>
      <PatientForm mode="create" action={createPatientForm} />
    </main>
  );
}
