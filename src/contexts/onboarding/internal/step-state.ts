/**
 * Contrato Zod do progresso do wizard (clinic_invites.step_state) — GAP 4.
 *
 * Nunca json livre. NUNCA guarda senha do gestor nem dado de cartão: a senha vive
 * só no estado do navegador e viaja no submit final do checkout (em retomada de
 * outra aba/sessão o gestor digita de novo). CPF/cartão jamais aqui.
 */
import { z } from 'zod';

export const ONBOARDING_STEPS = ['clinic', 'owner', 'plan', 'checkout'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const clinicData = z
  .object({
    nome: z.string().trim().max(120),
    cnpj: z.string().trim().max(20).optional(),
    telefone: z.string().trim().max(20).optional(),
    email: z.string().trim().max(160).optional(),
    endereco: z.string().trim().max(240).optional(),
    slug: z.string().trim().max(30).optional(),
  })
  .partial();

const ownerData = z
  .object({
    nome: z.string().trim().max(120),
    email: z.string().trim().max(160),
  })
  .partial();

export const stepStateSchema = z.object({
  currentStep: z.enum(ONBOARDING_STEPS),
  completed: z.array(z.enum(ONBOARDING_STEPS)).default([]),
  clinic: clinicData.optional(),
  owner: ownerData.optional(),
  planId: z.string().uuid().optional(),
});

export type StepState = z.infer<typeof stepStateSchema>;

export const EMPTY_STEP_STATE: StepState = { currentStep: 'clinic', completed: [] };

/** Lê step_state do banco com fallback seguro (jsonb pode estar nulo/corrompido). */
export function parseStepState(raw: unknown): StepState {
  const r = stepStateSchema.safeParse(raw);
  return r.success ? r.data : EMPTY_STEP_STATE;
}

/** Marca um passo como concluído (idempotente) e avança o currentStep. */
export function advanceStep(
  state: StepState,
  done: OnboardingStep,
  next: OnboardingStep,
): StepState {
  const completed = state.completed.includes(done) ? state.completed : [...state.completed, done];
  return { ...state, completed, currentStep: next };
}
