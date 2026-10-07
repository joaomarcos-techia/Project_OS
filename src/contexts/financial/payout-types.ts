import { z } from 'zod';

import type { ProfessionalPayoutBasis, ProfessionalPayoutRuleKind } from './schema';

const uuid = z.string().uuid();

export const SaveProfessionalPayoutPolicySchema = z
  .object({ basis: z.enum(['gross', 'net']) })
  .strict();
export type SaveProfessionalPayoutPolicyInput = z.infer<typeof SaveProfessionalPayoutPolicySchema>;

export const SaveProfessionalPayoutRuleSchema = z
  .object({
    professionalId: uuid,
    procedureId: uuid.nullable(),
    kind: z.enum(['percentage', 'fixed']),
    percentage: z.number().finite().positive().max(100).nullable(),
    fixedAmount: z.number().finite().nonnegative().max(99_999_999.99).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'percentage' && (value.percentage === null || value.fixedAmount !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe somente o percentual da regra.',
        path: ['percentage'],
      });
    }
    if (value.kind === 'fixed' && (value.fixedAmount === null || value.percentage !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe somente o valor fixo da regra.',
        path: ['fixedAmount'],
      });
    }
  });
export type SaveProfessionalPayoutRuleInput = z.infer<typeof SaveProfessionalPayoutRuleSchema>;

export const RemoveProfessionalPayoutRuleSchema = z.object({ ruleId: uuid }).strict();

/**
 * Revisão humana de repasse suspenso (decisão de 07/10/2026). O teto (cálculo
 * original) é validado no servidor, sob lock; aqui só forma e limites gerais.
 */
export const ReviewProfessionalPayoutSchema = z
  .object({
    payoutId: uuid,
    amount: z
      .number()
      .finite()
      .nonnegative()
      .max(99_999_999.99)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
        message: 'Use no máximo duas casas decimais.',
      }),
    reason: z
      .string()
      .trim()
      .min(3, 'Informe o motivo da revisão.')
      .max(500, 'Use no máximo 500 caracteres no motivo.'),
  })
  .strict();
export type ReviewProfessionalPayoutInput = z.infer<typeof ReviewProfessionalPayoutSchema>;

export interface ProfessionalPayoutReviewDTO {
  payoutId: string;
  version: number;
  decidedAmount: number;
  ceilingAmount: number;
  referenceAmount: number | null;
  decidedAt: string;
}

export interface ProfessionalPayoutPolicyDTO {
  basis: ProfessionalPayoutBasis;
  updatedAt: string | null;
}

export interface ProfessionalPayoutRuleDTO {
  id: string;
  professionalId: string;
  procedureId: string | null;
  kind: ProfessionalPayoutRuleKind;
  percentage: number | null;
  fixedAmount: number | null;
  effectiveFrom: string;
  updatedAt: string;
}

export interface ProfessionalPayoutDTO {
  id: string;
  appointmentId: string;
  professionalId: string;
  procedureId: string;
  calculationBasis: ProfessionalPayoutBasis;
  grossAmount: number;
  providerFeeAmount: number | null;
  earlySettlementFeeAmount: number | null;
  netAmount: number | null;
  basisAmount: number | null;
  payoutAmount: number | null;
  status: 'pending_economics' | 'calculated' | 'cancelled' | 'reviewed';
}
