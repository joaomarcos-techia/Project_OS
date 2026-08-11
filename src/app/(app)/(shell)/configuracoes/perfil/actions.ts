'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { updateOwnProfessionalCredential } from '@/contexts/identity/internal/professional-credential';
import { mapIdentityError } from '@/contexts/identity/internal/map-error';
import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';

const ProfessionalCredentialSchema = z.object({
  crm: z.string().trim().min(1, 'Informe o CRM.').max(20),
  crmUf: z
    .string()
    .trim()
    .length(2, 'Informe a UF do CRM.')
    .regex(/^[a-zA-Z]{2}$/, 'Informe uma UF válida.'),
  especialidade: z.string().trim().max(120).optional().default(''),
});

export type ProfessionalCredentialInput = z.input<typeof ProfessionalCredentialSchema>;
export type ProfessionalCredentialActionResult =
  | { ok: true; credential: { crm: string; crmUf: string; especialidade: string | null } }
  | { ok: false; message: string };

export async function updateProfessionalCredentialAction(
  input: ProfessionalCredentialInput,
): Promise<ProfessionalCredentialActionResult> {
  try {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
    const clinicId = await requireClinicId();
    const parsed = ProfessionalCredentialSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
    }
    const data = parsed.data;
    const credential = await updateOwnProfessionalCredential({
      clinicId,
      userId: user.userId,
      crm: data.crm,
      crmUf: data.crmUf,
      especialidade: data.especialidade,
      requestContext: buildRequestContext(await headers()),
    });
    revalidatePath('/configuracoes/perfil');
    return { ok: true, credential };
  } catch (err) {
    return { ok: false, message: mapIdentityError(err) };
  }
}
