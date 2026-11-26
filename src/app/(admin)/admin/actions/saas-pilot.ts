'use server';

import { headers } from 'next/headers';
import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { requireUser } from '@/lib/auth/tenant-context';
import { hashEmail } from '@/lib/auth/email-hash';
import {
  issuePilotInviteTx,
  pilotIdentitySchema,
  generateInviteToken,
  PilotSignupError,
} from '@/contexts/onboarding';
import { guardAdminAccess } from '../_lib/guard';

export type PilotInviteState = { error: string | null; link?: string; existing?: boolean };
export async function createSaasPilotInviteAction(
  _previous: PilotInviteState,
  formData: FormData,
): Promise<PilotInviteState> {
  await guardAdminAccess();
  const parsed = pilotIdentitySchema.safeParse({
    ownerName: formData.get('ownerName'),
    clinicName: formData.get('clinicName'),
    email: formData.get('email'),
  });
  if (!parsed.success) return { error: 'Confira os dados do titular e da clínica.' };
  const user = await requireUser();
  const { rawToken, tokenHash } = generateInviteToken();
  try {
    const result = await superAdminAction(
      {
        action: 'saas_pilot_invite_prepared',
        targetClinicId: null,
        payload: { emailHash: hashEmail(parsed.data.email), planCode: 'consultorio_2026' },
        requestContext: buildRequestContext(await headers()),
      },
      (tx) => issuePilotInviteTx(tx, { identity: parsed.data, createdBy: user.userId, tokenHash }),
    );
    return result.created || result.reissued === true
      ? { error: null, link: `/cadastro/piloto#invite=${rawToken}` }
      : { error: null, existing: true };
  } catch (error) {
    if (error instanceof PilotSignupError)
      return {
        error:
          error.code === 'conflict'
            ? 'Já existe uma conta, clínica ou convite incompatível. Confira o estado antes de continuar.'
            : 'O provisionamento restrito não está disponível. Nenhuma cobrança foi criada.',
      };
    throw error;
  }
}
