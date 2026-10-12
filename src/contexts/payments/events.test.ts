import { describe, expect, it } from 'vitest';

import { getEventSchema } from '@/lib/outbox/catalog';

import { PAYMENTS_EVENTS, PatientCreditGrantedSchema } from './events';

const legacyPayload: unknown = JSON.parse(`{
  "chargeId": "f672a866-1b85-45c5-95e1-6921c4cf08fe",
  "clinicId": "06d88192-7dc2-4953-b8f7-4fa875213ee8",
  "appointmentId": "6ffb0786-d0a4-40c6-b32d-64b226de9c6a",
  "patientId": "b7069e53-57b1-442e-befa-b95c35923710",
  "kind": "deposit",
  "amount": 150,
  "paidAt": "2026-08-25T12:00:00.000Z",
  "paymentMethod": "pix"
}`);

describe('payments.patient_credit.granted', () => {
  it('aceita o formato persistido antes dos campos economicos', () => {
    expect(getEventSchema(PAYMENTS_EVENTS.CREDIT_GRANTED)).toBe(PatientCreditGrantedSchema);
    expect(PatientCreditGrantedSchema.parse(legacyPayload)).toEqual(legacyPayload);
  });

  it('exige todos os campos economicos nos eventos novos', () => {
    const currentPayload = {
      ...PatientCreditGrantedSchema.parse(legacyPayload),
      providerGrossAmount: 150,
      providerFeeAmount: 5,
      providerNetAmount: 145,
      earlySettlementFeeAmount: null,
      installmentNumber: null,
    };
    expect(PatientCreditGrantedSchema.safeParse(currentPayload).success).toBe(true);

    for (const field of [
      'providerGrossAmount',
      'providerFeeAmount',
      'providerNetAmount',
      'earlySettlementFeeAmount',
      'installmentNumber',
    ] as const) {
      const incompletePayload: Record<string, unknown> = { ...currentPayload };
      delete incompletePayload[field];
      expect(PatientCreditGrantedSchema.safeParse(incompletePayload).success).toBe(false);
    }

    expect(
      PatientCreditGrantedSchema.safeParse({ ...currentPayload, providerFeeAmount: -1 }).success,
    ).toBe(false);
  });
});
