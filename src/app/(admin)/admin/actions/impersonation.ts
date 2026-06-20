'use server';

/**
 * Server Actions de impersonate (C15) — as ÚNICAS mutações de SESSÃO do painel.
 * Junto de actions/exports.ts, são a única superfície de escrita de /admin
 * (review #11: read-only garantido por estrutura + arch test).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { requireRecentAal2 } from '@/lib/auth/require-recent-aal2';
import { requireUser } from '@/lib/auth/tenant-context';
import { assertImpersonationRuntimeReady } from '@/lib/env';
import {
  createImpersonationSessionTx,
  setImpersonationCookie,
  stopImpersonation,
} from '@/lib/impersonation';

import { guardAdminAccess } from '../_lib/guard';

/**
 * Inicia impersonate (OR-I1..I3). Form action: lê clinicId do FormData. Exige
 * super_admin + AAL2 RECENTE (≤10min) — se expirado, manda re-fazer MFA.
 * Cria a sessão e o log impersonate_start na MESMA tx; seta o cookie; entra no
 * app tenant como a clínica.
 */
export async function startImpersonationAction(formData: FormData): Promise<void> {
  await guardAdminAccess();
  assertImpersonationRuntimeReady();

  const clinicId = z.string().uuid().parse(formData.get('clinicId'));

  // Step-up: se o MFA não foi provado nos últimos 10min, re-challenge (não erro).
  try {
    await requireRecentAal2(10);
  } catch {
    redirect('/login/mfa?reason=step_up');
  }

  const user = await requireUser();
  const rc = buildRequestContext(await headers());

  const impersonationId = await superAdminAction(
    {
      action: 'impersonate_start',
      targetClinicId: clinicId,
      payload: { clinicId },
      requestContext: rc,
    },
    (tx) =>
      createImpersonationSessionTx(tx, {
        superAdminId: user.userId,
        clinicId,
        ip: rc.ip,
        userAgent: rc.userAgent,
      }),
  );

  await setImpersonationCookie(impersonationId);
  redirect('/dashboard');
}

/** Encerra impersonate (OR-I10). Revoga a sessão, limpa o cookie e loga. */
export async function stopImpersonationAction(): Promise<void> {
  await guardAdminAccess();
  const rc = buildRequestContext(await headers());
  const stopped = await stopImpersonation();
  if (stopped) {
    await superAdminAction(
      {
        action: 'impersonate_stop',
        targetClinicId: null,
        payload: { impersonationId: stopped.impersonationId },
        requestContext: rc,
      },
      async () => {},
    );
  }
  redirect('/admin');
}
