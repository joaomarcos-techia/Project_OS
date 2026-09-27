import { z } from 'zod';

/** Quantos profissionais atendem na clínica. */
export const PROFESSIONALS_BANDS = ['1', '2_5', '6_15', '16_plus'] as const;

/** Atendimentos por semana, em faixa e nunca em número livre. */
export const WEEKLY_APPOINTMENT_BANDS = ['ate_20', '21_50', '51_100', '100_plus'] as const;

/** `outro_sistema` oferece o importador no onboarding futuro. */
export const CURRENT_TOOLING = ['nada_papel', 'agenda_generica', 'outro_sistema'] as const;

/** Canal declarado. Guarda o canal, nunca quem indicou. */
export const DISCOVERY_SOURCES = [
  'busca_google',
  'indicacao_colega',
  'redes_sociais',
  'grupo_comunidade',
  'evento',
  'outro',
] as const;

/** Quatro respostas impessoais, sem CAS nem qualquer campo livre. */
export const signupAnswerValuesSchema = z
  .object({
    professionalsBand: z.enum(PROFESSIONALS_BANDS),
    weeklyAppointmentsBand: z.enum(WEEKLY_APPOINTMENT_BANDS),
    currentTooling: z.enum(CURRENT_TOOLING),
    discoverySource: z.enum(DISCOVERY_SOURCES),
  })
  .strict();

export type SignupAnswerValues = z.infer<typeof signupAnswerValuesSchema>;
