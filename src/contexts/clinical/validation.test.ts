import { describe, expect, it } from 'vitest';

import {
  CreateMedicalDocumentSchema,
  CreatePrescriptionSchema,
  ProntuarioContentSchema,
  SignProntuarioSchema,
} from './types';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('ProntuarioContentSchema (Regra 2 — estruturado)', () => {
  it('aceita campos SOAP/estruturados válidos', () => {
    expect(
      ProntuarioContentSchema.safeParse({
        queixa_principal: 'dor de cabeça',
        subjective: 'há 2 dias',
      }).success,
    ).toBe(true);
  });

  it('aceita objeto vazio (rascunho recém-criado)', () => {
    expect(ProntuarioContentSchema.safeParse({}).success).toBe(true);
  });

  it('rejeita chave desconhecida (strict — anti-lixo no jsonb)', () => {
    expect(ProntuarioContentSchema.safeParse({ campo_inventado: 'x' }).success).toBe(false);
  });
});

describe('SignProntuarioSchema (needs_return — teste 7.6.5)', () => {
  it('aceita needsReturn=false sem returnDays', () => {
    expect(SignProntuarioSchema.safeParse({ needsReturn: false }).success).toBe(true);
  });

  it('aceita needsReturn=true com returnDays', () => {
    expect(SignProntuarioSchema.safeParse({ needsReturn: true, returnDays: 90 }).success).toBe(true);
  });

  it('rejeita needsReturn=true SEM returnDays', () => {
    expect(SignProntuarioSchema.safeParse({ needsReturn: true }).success).toBe(false);
  });

  it('rejeita returnDays <= 0', () => {
    expect(SignProntuarioSchema.safeParse({ needsReturn: true, returnDays: 0 }).success).toBe(false);
  });
});

describe('CreatePrescriptionSchema', () => {
  it('exige pelo menos um medicamento', () => {
    expect(
      CreatePrescriptionSchema.safeParse({ patientId: UUID, medicamentos: [] }).success,
    ).toBe(false);
  });

  it('aceita prescrição com medicamentos', () => {
    expect(
      CreatePrescriptionSchema.safeParse({
        patientId: UUID,
        medicamentos: [{ nome: 'Dipirona', dosagem: '500mg', posologia: '1 cp 6/6h' }],
      }).success,
    ).toBe(true);
  });
});

describe('CreateMedicalDocumentSchema (discriminated union por tipo)', () => {
  it('atestado exige descricao', () => {
    expect(
      CreateMedicalDocumentSchema.safeParse({ patientId: UUID, type: 'atestado', content: {} })
        .success,
    ).toBe(false);
    expect(
      CreateMedicalDocumentSchema.safeParse({
        patientId: UUID,
        type: 'atestado',
        content: { descricao: 'compareceu à consulta', dias: 2 },
      }).success,
    ).toBe(true);
  });

  it('exame exige ao menos um exame', () => {
    expect(
      CreateMedicalDocumentSchema.safeParse({ patientId: UUID, type: 'exame', content: { exames: [] } })
        .success,
    ).toBe(false);
    expect(
      CreateMedicalDocumentSchema.safeParse({
        patientId: UUID,
        type: 'exame',
        content: { exames: ['Hemograma'] },
      }).success,
    ).toBe(true);
  });

  it('rejeita conteúdo incompatível com o tipo', () => {
    expect(
      CreateMedicalDocumentSchema.safeParse({
        patientId: UUID,
        type: 'encaminhamento',
        content: { descricao: 'isto é de atestado' },
      }).success,
    ).toBe(false);
  });
});
