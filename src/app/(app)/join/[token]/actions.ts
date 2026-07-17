'use server';

/**
 * Persistência dos passos do wizard (F1). SEM sessão: a "auth" é o token validado.
 * Cada passo grava no `step_state` via UPDATE guardado por `version` (GAP 5: a 2ª
 * aba perde a corrida). NUNCA grava senha do gestor nem cartão.
 */
import { headers } from 'next/headers';
import { z } from 'zod';

import {
  OnboardingProvisionError,
  advanceStep,
  guardedUpdateInvite,
  parseStepState,
  resolveCheckoutPlan,
  resolveOpenInvite,
  runCheckout,
  stepStateSchema,
  type OnboardingStep,
} from '@/contexts/onboarding';
import { assertJoinAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createServerClient } from '@/lib/auth/supabase-server';

export type JoinStepState = { error: string | null; ok?: boolean };

const NEXT: Record<string, OnboardingStep> = { clinic: 'owner', owner: 'plan', plan: 'checkout' };

/** Gera um slug candidato a partir do nome (a unicidade/reservados é checada no provisionamento). */
function slugify(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

const ClinicStep = z.object({
  nome: z.string().trim().min(2).max(120),
  cnpj: z.string().trim().max(20).optional().or(z.literal('')),
  telefone: z.string().trim().max(20).optional().or(z.literal('')),
  email: z.string().trim().max(160).optional().or(z.literal('')),
  endereco: z.string().trim().max(240).optional().or(z.literal('')),
});
const OwnerStep = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
});
const PlanStep = z.object({ planId: z.string().uuid() });

export async function saveStepAction(_prev: JoinStepState, formData: FormData): Promise<JoinStepState> {
  const token = String(formData.get('token') ?? '');
  const step = String(formData.get('step') ?? '');
  const next = NEXT[step];
  if (!next) return { error: 'Passo inválido.' };

  // M3: `resolveOpenInvite` é a superfície de sondagem de token do wizard, e era a
  // única do /join sem teto (o checkout já tinha). Reusa o MESMO limiter do join —
  // é o mesmo fluxo e o mesmo abuso; um limiter novo só fragmentaria o orçamento.
  const rl = await assertJoinAllowed(getClientIp(await headers()));
  if (!rl.ok) return { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };

  const invite = await resolveOpenInvite(token);
  if (!invite) return { error: 'Convite inválido ou expirado.' };
  const current = parseStepState(invite.stepState);

  let merged = current;
  if (step === 'clinic') {
    const p = ClinicStep.safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: 'Verifique os dados da clínica (nome obrigatório).' };
    merged = advanceStep(
      {
        ...current,
        clinic: {
          nome: p.data.nome,
          cnpj: p.data.cnpj || undefined,
          telefone: p.data.telefone || undefined,
          email: p.data.email || undefined,
          endereco: p.data.endereco || undefined,
          slug: slugify(p.data.nome),
        },
      },
      'clinic',
      next,
    );
  } else if (step === 'owner') {
    const p = OwnerStep.safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: 'Verifique nome e e-mail do gestor.' };
    merged = advanceStep({ ...current, owner: { nome: p.data.nome, email: p.data.email } }, 'owner', next);
  } else if (step === 'plan') {
    const p = PlanStep.safeParse(Object.fromEntries(formData));
    if (!p.success) return { error: 'Selecione um plano.' };
    merged = advanceStep({ ...current, planId: p.data.planId }, 'plan', next);
  }

  const valid = stepStateSchema.safeParse(merged);
  if (!valid.success) return { error: 'Dados inválidos.' };

  const updated = await guardedUpdateInvite(invite.id, invite.version, { stepState: valid.data as never });
  if (!updated) return { error: 'O convite foi alterado em outra aba. Recarregue a página.' };
  return { error: null, ok: true };
}

/* ===================================================================== */

export type CheckoutState = { error: string | null; ok?: boolean; cardError?: boolean };

const TRIAL_DAYS = 7; // decisão do produto (ADR-027): trial de 7 dias na assinatura.
const onlyDigits = (v: FormDataEntryValue | null) => String(v ?? '').replace(/\D/g, '');

/**
 * Ativação final (checkout) — rota pública, SEM sessão. Rate-limit → valida o token/
 * step_state → resolve preço NO SERVIDOR → Asaas (cartão só em memória, nunca logado/
 * persistido) → saga (clínica trial + owner + ai_config) com compensação. Idempotência
 * natural: o convite vira `completed` (guarded por version) — re-submeter dá inválido.
 */
export async function submitCheckoutAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const ip = getClientIp(await headers());
  const rl = await assertJoinAllowed(ip);
  if (!rl.ok) return { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };

  const token = String(formData.get('token') ?? '');
  const invite = await resolveOpenInvite(token);
  if (!invite || invite.status !== 'started') return { error: 'Convite inválido, expirado ou já ativado.' };

  const st = parseStepState(invite.stepState);
  if (!st.clinic?.nome || !st.clinic.slug || !st.owner?.nome || !st.owner.email || !st.planId) {
    return { error: 'Complete os passos anteriores antes de ativar.' };
  }

  // Cartão + dados de cobrança — NUNCA logados/persistidos (só transitam aqui).
  const cardNumber = onlyDigits(formData.get('cardNumber'));
  const cardName = String(formData.get('cardName') ?? '').trim();
  const cvv = onlyDigits(formData.get('cardCvv'));
  const cpfCnpj = onlyDigits(formData.get('cpfCnpj'));
  const cep = onlyDigits(formData.get('cep'));
  const addressNumber = String(formData.get('addressNumber') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const exp = String(formData.get('cardExpiry') ?? '').trim().match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);

  if (
    cardNumber.length < 13 ||
    cardNumber.length > 19 ||
    cardName.length < 2 ||
    !exp ||
    cvv.length < 3 ||
    cvv.length > 4 ||
    (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) ||
    cep.length !== 8 ||
    addressNumber.length < 1 ||
    password.length < 8
  ) {
    return { error: 'Verifique os dados do cartão e de cobrança (CPF/CNPJ, CEP, número).' };
  }
  const expiryYear = exp[2]!.length === 2 ? `20${exp[2]!}` : exp[2]!;

  const plan = await resolveCheckoutPlan(st.planId);
  if (!plan) return { error: 'Plano indisponível. Volte e escolha outro plano.' };

  try {
    await runCheckout({
      invite: { id: invite.id, version: invite.version },
      clinic: {
        nome: st.clinic.nome,
        slug: st.clinic.slug,
        cnpj: st.clinic.cnpj ?? null,
        telefone: st.clinic.telefone ?? null,
        endereco: st.clinic.endereco ?? null,
      },
      owner: { nome: st.owner.nome, email: st.owner.email },
      password,
      card: { number: cardNumber, holderName: cardName, expiryMonth: exp[1]!, expiryYear, ccv: cvv },
      holder: { cpfCnpj, postalCode: cep, addressNumber },
      plan,
      trialDays: TRIAL_DAYS,
      remoteIp: ip,
    });
  } catch (e) {
    if (e instanceof OnboardingProvisionError) {
      if (e.code === 'card_declined') {
        // e.message já é a razão legível do Asaas (CPF/cartão inválido etc.).
        return { error: `${e.message} Nenhuma cobrança foi feita.`, cardError: true };
      }
      if (e.code === 'provider_unreachable') {
        return { error: 'O provedor de pagamento (Asaas) está indisponível agora. Tente de novo em instantes.' };
      }
      if (e.code === 'invite_version_conflict') return { error: 'Este convite já foi ativado.' };
      if (e.code === 'owner_create_failed') {
        return { error: 'Não foi possível criar seu acesso (e-mail já em uso?). Use outro e-mail ou fale com o suporte.' };
      }
    }
    // Erro inesperado (DB/slug/código): loga no servidor p/ diagnóstico (sem dado de cartão).
    console.error('[checkout] ativação falhou:', e);
    return { error: 'Falha ao ativar. Nenhuma cobrança foi confirmada — tente de novo em instantes.' };
  }

  // Auto-login do owner — "entra na hora" (decisão de produto). Define os cookies
  // de sessão nesta server action. Best-effort: se falhar, o owner só loga manual.
  try {
    const supabase = await createServerClient();
    await supabase.auth.signInWithPassword({ email: st.owner.email, password });
  } catch {
    /* não-fatal — a clínica já está ativa; o owner entra pelo /login */
  }

  return { error: null, ok: true };
}
