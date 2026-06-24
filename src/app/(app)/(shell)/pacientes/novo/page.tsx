/**
 * /pacientes/novo — create form. requireFreshPermission(create:patient) is
 * enforced inside the action; this page just renders the form.
 */
import Link from 'next/link';

import { requireUser } from '@/lib/auth/tenant-context';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { createPatientForm } from '../actions';
import { PatientForm } from '../patient-form';

export const dynamic = 'force-dynamic';

export default async function NovoPacientePage() {
  await requireUser();
  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/pacientes">Pacientes</Link> <span className="sep">›</span> <b>Novo</b>
          </>
        }
        title="Novo paciente"
        description="Cadastre um novo paciente da clínica."
        actions={
          <Link href="/pacientes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Voltar
          </Link>
        }
      />

      <div className="cardblock wrap-pad" style={{ maxWidth: 680 }}>
        <PatientForm mode="create" action={createPatientForm} />
      </div>
    </div>
  );
}
