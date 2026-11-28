import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcedureSummary } from '@/contexts/scheduling/types';
import type {
  PrescriptionTemplateInput,
  PrescriptionTemplateSummary,
} from '@/contexts/clinical/types';
import { TrialAccessError } from '@/lib/trial-access/policy';

vi.mock('@/contexts/scheduling/catalog-actions', () => ({ createProcedure: vi.fn() }));
vi.mock('@/contexts/clinical/actions-templates', () => ({
  createPrescriptionTemplate: vi.fn(),
  duplicatePrescriptionTemplate: vi.fn(),
}));
import { createProcedure } from '@/contexts/scheduling/catalog-actions';
import {
  createPrescriptionTemplate,
  duplicatePrescriptionTemplate,
} from '@/contexts/clinical/actions-templates';
import {
  createProcedureWithTrialLimit,
  createTemplateWithTrialLimit,
  duplicateTemplateWithTrialLimit,
} from './create-limited';

const procedureInput = {
  codigo: 'TEST',
  descricao: 'Synthetic',
  valorPadrao: 100,
  duracaoPadraoMin: 30,
};
const templateInput: PrescriptionTemplateInput = {
  nome: 'Synthetic',
  kind: 'simples',
  medicamentos: [{ nome: 'Synthetic medication — not for use' }],
};
beforeEach(() => vi.resetAllMocks());
describe('quota feedback across the Server Action boundary', () => {
  it('returns a successful procedure unchanged', async () => {
    const row: ProcedureSummary = {
      id: 'synthetic',
      clinicId: 'synthetic',
      ...procedureInput,
      categoria: null,
      ativo: true,
      createdAt: '2026-11-08T00:00:00Z',
      updatedAt: '2026-11-08T00:00:00Z',
    };
    vi.mocked(createProcedure).mockResolvedValueOnce(row);
    expect(await createProcedureWithTrialLimit(procedureInput, 'key')).toEqual({
      ok: true,
      data: row,
    });
    expect(createProcedure).toHaveBeenCalledWith(procedureInput, 'key');
  });
  it('returns a successful template unchanged', async () => {
    const row: PrescriptionTemplateSummary = {
      id: 'synthetic',
      clinicId: 'synthetic',
      doctorId: 'synthetic',
      ...templateInput,
      categoria: null,
      kind: 'simples',
      observacoes: null,
      createdAt: '2026-11-08T00:00:00Z',
      updatedAt: '2026-11-08T00:00:00Z',
    };
    vi.mocked(createPrescriptionTemplate).mockResolvedValueOnce(row);
    expect(await createTemplateWithTrialLimit(templateInput, 'key')).toEqual({
      ok: true,
      data: row,
    });
  });
  it('returns the safe quota message instead of an RSC production exception', async () => {
    for (const operation of [
      () => createProcedureWithTrialLimit(procedureInput, 'key'),
      () => createTemplateWithTrialLimit(templateInput, 'key'),
      () => duplicateTemplateWithTrialLimit('synthetic', 'key'),
    ]) {
      const error = new TrialAccessError('document_templates');
      vi.mocked(createProcedure).mockRejectedValueOnce(error);
      vi.mocked(createPrescriptionTemplate).mockRejectedValueOnce(error);
      vi.mocked(duplicatePrescriptionTemplate).mockRejectedValueOnce(error);
      expect(await operation()).toEqual({ ok: false, message: error.message });
      vi.resetAllMocks();
    }
  });
  it('propagates unexpected failures for existing monitoring', async () => {
    const error = new Error('synthetic database outage');
    vi.mocked(createProcedure).mockRejectedValueOnce(error);
    await expect(createProcedureWithTrialLimit(procedureInput, 'key')).rejects.toBe(error);
  });
});
