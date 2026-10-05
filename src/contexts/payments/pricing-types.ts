import { z } from 'zod';

import type { ClinicPricingPolicyMode, ProcedurePaymentMethod } from './schema';

export const SavePaymentPricingPolicySchema = z
  .object({ mode: z.enum(['absorb_fees', 'payment_method_pricing']) })
  .strict();
export type SavePaymentPricingPolicyInput = z.infer<typeof SavePaymentPricingPolicySchema>;

export const SaveProcedurePaymentPriceSchema = z
  .object({
    procedureId: z.string().uuid(),
    paymentMethod: z.enum(['pix', 'cash', 'credit_card']),
    installmentCount: z.number().int().min(1).max(12).nullable(),
    grossAmount: z
      .number()
      .finite()
      .min(0.01)
      .max(99_999_999.99)
      .refine((amount) => Number(amount.toFixed(2)) === amount, {
        message: 'Informe um valor em centavos, sem fração de centavo.',
      }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.paymentMethod === 'credit_card' && value.installmentCount === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a quantidade de parcelas do cartão.',
        path: ['installmentCount'],
      });
    }
    if (
      value.paymentMethod === 'credit_card' &&
      value.installmentCount !== null &&
      value.installmentCount !== 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O Checkout de cartão está disponível apenas em 1x.',
        path: ['installmentCount'],
      });
    }
    if (value.paymentMethod !== 'credit_card' && value.installmentCount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Parcelas só se aplicam ao cartão.',
        path: ['installmentCount'],
      });
    }
  });
export type SaveProcedurePaymentPriceInput = z.infer<typeof SaveProcedurePaymentPriceSchema>;

export const RemoveProcedurePaymentPriceSchema = z.object({ priceId: z.string().uuid() }).strict();

export interface PaymentPricingPolicyDTO {
  mode: ClinicPricingPolicyMode;
  updatedAt: string | null;
}

export interface ProcedurePaymentPriceDTO {
  id: string;
  procedureId: string;
  paymentMethod: ProcedurePaymentMethod;
  installmentCount: number | null;
  grossAmount: number;
  updatedAt: string;
}
