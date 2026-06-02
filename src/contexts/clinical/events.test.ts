import { describe, expect, it } from 'vitest';

import { getEventSchema } from '@/lib/outbox/catalog';

import {
  CLINICAL_EVENTS,
  DocumentGeneratedSchema,
  ProntuarioCreatedSchema,
  ProntuarioSignedSchema,
} from './events';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('CLINICAL_EVENTS — nomes 3-segmentos registrados no catálogo', () => {
  it('todos os 4 eventos estão no catálogo do outbox', () => {
    for (const name of Object.values(CLINICAL_EVENTS)) {
      expect(name.split('.')).toHaveLength(3);
      expect(getEventSchema(name)).toBeDefined();
    }
  });
});

describe('ProntuarioSignedSchema (needs_return no payload — teste 7.6.5)', () => {
  it('aceita payload com needsReturn + returnDays', () => {
    const r = ProntuarioSignedSchema.safeParse({
      prontuarioId: UUID,
      clinicId: UUID,
      patientId: UUID,
      signedBy: UUID,
      signedAt: '2026-06-01T12:00:00Z',
      needsReturn: true,
      returnDays: 90,
    });
    expect(r.success).toBe(true);
  });

  it('returnDays pode ser null (needsReturn=false)', () => {
    const r = ProntuarioSignedSchema.safeParse({
      prontuarioId: UUID,
      clinicId: UUID,
      patientId: UUID,
      signedBy: UUID,
      signedAt: '2026-06-01T12:00:00Z',
      needsReturn: false,
      returnDays: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejeita signedAt que não é datetime ISO (JSON-safe)', () => {
    const r = ProntuarioSignedSchema.safeParse({
      prontuarioId: UUID,
      clinicId: UUID,
      patientId: UUID,
      signedBy: UUID,
      signedAt: 'ontem',
      needsReturn: false,
      returnDays: null,
    });
    expect(r.success).toBe(false);
  });
});

describe('ProntuarioCreatedSchema', () => {
  it('appointmentId pode ser null (prontuário manual standalone)', () => {
    expect(
      ProntuarioCreatedSchema.safeParse({
        prontuarioId: UUID,
        clinicId: UUID,
        patientId: UUID,
        doctorId: UUID,
        appointmentId: null,
        createdBy: UUID,
      }).success,
    ).toBe(true);
  });
});

describe('DocumentGeneratedSchema', () => {
  it('type deve ser um dos 4 tipos', () => {
    expect(
      DocumentGeneratedSchema.safeParse({
        documentId: UUID,
        clinicId: UUID,
        patientId: UUID,
        doctorId: UUID,
        type: 'receita',
        createdAt: '2026-06-01T12:00:00Z',
      }).success,
    ).toBe(false);
  });
});
