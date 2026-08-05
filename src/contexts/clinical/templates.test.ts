import { describe, expect, it } from 'vitest';

import { toPrescriptionTemplateSummary } from './queries';
import type { PrescriptionTemplateRow } from './schema';

const baseRow: PrescriptionTemplateRow = {
  id: '11111111-1111-1111-1111-111111111111',
  clinicId: '22222222-2222-2222-2222-222222222222',
  doctorId: '33333333-3333-3333-3333-333333333333',
  nome: 'Sertralina início',
  categoria: 'Psiquiatria',
  medicamentos: [
    { nome: 'Sertralina', dosagem: '50mg', posologia: '1 cp manhã', quantidade: '30' },
  ],
  observacoes: 'Uso contínuo',
  kind: 'simples',
  createdBy: '33333333-3333-3333-3333-333333333333',
  createdAt: new Date('2026-06-01T12:00:00Z'),
  updatedAt: new Date('2026-06-02T12:00:00Z'),
};

describe('toPrescriptionTemplateSummary', () => {
  it('mapeia a row para o DTO com timestamps ISO', () => {
    const dto = toPrescriptionTemplateSummary(baseRow);
    expect(dto.id).toBe(baseRow.id);
    expect(dto.nome).toBe('Sertralina início');
    expect(dto.categoria).toBe('Psiquiatria');
    expect(dto.kind).toBe('simples');
    expect(dto.medicamentos).toHaveLength(1);
    expect(dto.createdAt).toBe('2026-06-01T12:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-06-02T12:00:00.000Z');
  });

  it('normaliza categoria/observacoes nulos para null', () => {
    const dto = toPrescriptionTemplateSummary({ ...baseRow, categoria: null, observacoes: null });
    expect(dto.categoria).toBeNull();
    expect(dto.observacoes).toBeNull();
  });
});
