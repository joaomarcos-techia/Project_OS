'use server';

import { listPatients } from '@/contexts/patient/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireUser,
} from '@/lib/auth/tenant-context';

/** Busca tenant-scoped para o ponto de entrada de criação clínica avulsa. */
export async function buscarPacientesParaDocumento(
  term: string,
): Promise<Array<{ id: string; label: string }>> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.VIEW_PATIENT);
  await requireCachedAnyPermission([
    PERMISSIONS.CREATE_PRONTUARIO,
    PERMISSIONS.CREATE_PRESCRIPTION,
  ]);
  const clinicId = await requireClinicId();
  const normalized = term.trim().slice(0, 64);
  if (normalized.length < 2) return [];

  const rows = await listPatients(clinicId, {
    search: normalized,
    limit: 10,
    excludeDeceased: true,
  });
  return rows.map((patient) => ({ id: patient.id, label: patient.nome }));
}
