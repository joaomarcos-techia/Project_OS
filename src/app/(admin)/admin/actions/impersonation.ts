'use server';

/**
 * Server Actions de impersonate (C15) — as ÚNICAS mutações de SESSÃO do painel.
 * Junto de clinicas/[id]/audit/export, são a única superfície de escrita de
 * /admin (review #11: read-only garantido por estrutura + arch test).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { challengeAndVerify, listFactors } from '@/lib/auth/mfa';
import { createServerClient } from '@/lib/auth/supabase-server';
import { requireUser } from '@/lib/auth/tenant-context';
import { assertImpersonationRuntimeReady } from '@/lib/env';
import {
  createImpersonationSessionTx,
  setImpersonationCookie,
  stopImpersonation,
} from '@/lib/impersonation';

import { guardAdminAccess } from '../_lib/guard';

export type ImpersonateState = { error: string | null };

/**
 * Inicia impersonate (OR-I1..I3). MFA OBRIGATÓRIO a cada impersonate (step-up):
 * o TOTP é verificado AQUI, inline (não há bounce para /login/mfa). Form action
 * (useActionState): devolve { error } p/ o formulário mostrar; em sucesso cria a
 * sessão + log e entra na clínica.
 */
export async function startImpersonationAction(
  _prev: ImpersonateState,
  formData: FormData,
): Promise<ImpersonateState> {
  await guardAdminAccess();
  assertImpersonationRuntimeReady();

  const clinic = z.string().uuid().safeParse(formData.get('clinicId'));
  if (!clinic.success) return { error: 'Clínica inválida.' };
  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) return { error: 'O código do autenticador tem 6 dígitos.' };

  // Step-up: re-verifica o TOTP agora (a cada impersonate).
  const supabase = await createServerClient({ cookieWrites: 'required' });
  let factors;
  try {
    factors = await listFactors(supabase);
  } catch {
    return { error: 'Não foi possível verificar o MFA. Tente novamente.' };
  }
  const verified = factors.find((f) => f.status === 'verified');
  if (!verified) return { error: 'Nenhum autenticador (TOTP) configurado nesta conta.' };
  try {
    await challengeAndVerify(supabase, verified.id, code);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Código inválido.' };
  }

  // TOTP ok → cria a sessão + log impersonate_start (atômico) e seta o cookie.
  const user = await requireUser();
  const rc = buildRequestContext(await headers());
  const impersonationId = await superAdminAction(
    {
      action: 'impersonate_start',
      targetClinicId: clinic.data,
      payload: { clinicId: clinic.data },
      requestContext: rc,
    },
    (tx) =>
      createImpersonationSessionTx(tx, {
        superAdminId: user.userId,
        clinicId: clinic.data,
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
