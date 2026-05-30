/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId.
 */
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { listPatients } from '@/contexts/patient/queries';

export const dynamic = 'force-dynamic';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { q } = await searchParams;
  const patients = await listPatients(clinicId, q ? { search: q, limit: 50 } : { limit: 50 });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pacientes</h1>
        <Link
          href="/pacientes/novo"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white"
        >
          Novo paciente
        </Link>
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por nome…"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </form>

      {patients.length === 0 ? (
        <p className="text-sm text-gray-600">Nenhum paciente encontrado.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {patients.map((p) => (
            <li key={p.id}>
              <Link
                href={`/pacientes/${p.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span className="font-medium">{p.nome}</span>
                <span className="font-mono text-gray-600">{p.email}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
