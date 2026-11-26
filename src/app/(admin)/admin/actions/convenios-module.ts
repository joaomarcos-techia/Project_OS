'use server';

/**
 * P1.13 — interruptor de Convênios por clínica no console da plataforma.
 *
 * Configuração de PLATAFORMA (não é mutação de dado clínico): mesmo padrão do impersonate e das platform flags.
 * `guardAdminAccess` (404 se não for super admin com AAL2) → TOTP verificado de novo a CADA mudança (step-up,
 * como o impersonate) → serviço do Convênios (`setConveniosModuleForClinic`): disponibilidade comercial
 * (`convenios.available`) para ligar, assinatura que inclui Convênios (no serviço e no gatilho do banco), motivo
 * obrigatório, registro em `super_admin_actions` e na trilha da PRÓPRIA clínica, idempotente.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ConveniosPlatformError, setConveniosModuleForClinic } from '@/contexts/health-insurance';
import { buildRequestContext } from '@/lib/audit/request-context';
import { challengeAndVerify, listFactors } from '@/lib/auth/mfa';
import { createServerClient } from '@/lib/auth/supabase-server';

import { guardAdminAccess } from '../_lib/guard';

export type ConveniosModuleFormState = {
  error: string | null;
  done?: 'enabled' | 'disabled' | 'unchanged';
};

const Input = z.object({
  clinicId: z.string().uuid(),
  enabled: z.enum(['true', 'false']),
  reason: z.string().trim().min(5, 'Informe o motivo (5 caracteres ou mais).').max(300),
  code: z.string().regex(/^\d{6}$/, 'O código do autenticador tem 6 dígitos.'),
});

export async function setConveniosModuleAction(
  _prev: ConveniosModuleFormState,
  formData: FormData,
): Promise<ConveniosModuleFormState> {
  await guardAdminAccess();
  const parsed = Input.safeParse({
    clinicId: formData.get('clinicId'),
    enabled: formData.get('enabled'),
    reason: formData.get('reason') ?? '',
    code: String(formData.get('code') ?? '').trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = parsed.data;

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
    await challengeAndVerify(supabase, verified.id, d.code);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Código inválido.' };
  }

  try {
    const result = await setConveniosModuleForClinic(
      { clinicId: d.clinicId, enabled: d.enabled === 'true', reason: d.reason },
      buildRequestContext(await headers()),
    );
    revalidatePath(`/admin/clinicas/${d.clinicId}`);
    return {
      error: null,
      done: !result.changed ? 'unchanged' : result.enabled ? 'enabled' : 'disabled',
    };
  } catch (e) {
    if (e instanceof ConveniosPlatformError) return { error: e.message };
    throw e;
  }
}
