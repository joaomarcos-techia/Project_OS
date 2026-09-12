import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listClinicalDocumentFeedPage } from './queries';

interface FeedRow {
  kind: 'prescription' | 'document';
  id: string;
  patient_id: string;
  patient_nome: string;
  source_type: string;
  created_at: Date;
  has_pdf: boolean;
}

function row(index: number, kind: FeedRow['kind'] = 'prescription'): FeedRow {
  return {
    kind,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    patient_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    patient_nome: `Paciente ${index}`,
    source_type: kind === 'prescription' ? 'simples' : 'atestado',
    created_at: new Date(`2026-08-20T12:${String(index % 60).padStart(2, '0')}:00.000Z`),
    has_pdf: index % 2 === 0,
  };
}

function setup(rows: FeedRow[], total: number) {
  const tx = { execute: vi.fn() };
  tx.execute.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ total }]);
  withTenant.mockImplementation(
    async (_clinicId: string, callback: (transaction: typeof tx) => unknown) => callback(tx),
  );
  return tx;
}

function compile(statement: unknown) {
  return new PgDialect().sqlToQuery(statement as SQL);
}

describe('listClinicalDocumentFeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { total: 0, visible: 0 },
    { total: 1, visible: 1 },
    { total: 50, visible: 50 },
    { total: 51, visible: 50 },
  ])('retorna total=$total com $visible itens na primeira página', async ({ total, visible }) => {
    const rows = Array.from({ length: visible }, (_, index) =>
      row(index + 1, index % 2 === 0 ? 'prescription' : 'document'),
    );
    const tx = setup(rows, total);

    const result = await listClinicalDocumentFeedPage('clinic-a');

    expect(result).toMatchObject({ total, page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(visible);
    expect(withTenant).toHaveBeenCalledWith('clinic-a', expect.any(Function));
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('pagina o UNION global e fecha empates por tipo e id', async () => {
    const tx = setup([row(51, 'document')], 51);

    const result = await listClinicalDocumentFeedPage('clinic-a', { page: 2 });

    expect(result).toMatchObject({ total: 51, page: 2, pageSize: 50 });
    const pageQuery = compile(tx.execute.mock.calls[0]?.[0]);
    const statement = pageQuery.sql.toLowerCase();
    expect(statement).toContain('union all');
    expect(statement).toContain('order by created_at desc, kind desc, id desc');
    expect(statement.match(/ limit /g)).toHaveLength(1);
    expect(statement.match(/ offset /g)).toHaveLength(1);
    expect(pageQuery.params.slice(-2)).toEqual([50, 50]);
  });

  it('aplica tenant, paciente e busca igualmente à página e ao total', async () => {
    const tx = setup([row(1)], 1);

    await listClinicalDocumentFeedPage('clinic-a', {
      patientId: 'patient-a',
      search: '  Ana  ',
    });

    const pageQuery = compile(tx.execute.mock.calls[0]?.[0]);
    const countQuery = compile(tx.execute.mock.calls[1]?.[0]);
    expect(pageQuery.sql).toContain('"prescriptions"."clinic_id" =');
    expect(pageQuery.sql).toContain('"medical_documents"."clinic_id" =');
    expect(pageQuery.sql).toContain('"prescriptions"."patient_id" =');
    expect(pageQuery.sql).toContain('"medical_documents"."patient_id" =');
    expect(pageQuery.sql.match(/ ilike /g)).toHaveLength(2);
    expect(pageQuery.params.slice(0, -2)).toEqual(countQuery.params);
    expect(countQuery.params).toEqual([
      'clinic-a',
      'patient-a',
      '%Ana%',
      'clinic-a',
      'patient-a',
      '%Ana%',
    ]);
  });

  it('consulta somente prescrições quando o tipo é restrito', async () => {
    const tx = setup([row(1)], 1);

    const result = await listClinicalDocumentFeedPage('clinic-a', { kind: 'prescription' });

    const pageQuery = compile(tx.execute.mock.calls[0]?.[0]);
    const statement = pageQuery.sql.toLowerCase();
    expect(statement).toContain('from "prescriptions"');
    expect(statement).not.toContain('medical_documents');
    expect(statement).not.toContain('union all');
    expect(result.items[0]).toMatchObject({
      kind: 'prescription',
      label: 'Receita simples',
      type: 'simples',
      pdfHref: `/prescricoes/${row(1).id}/pdf`,
    });
  });

  it('mapeia documentos médicos sem expor conteúdo cifrado', async () => {
    const medicalDocument = row(1, 'document');
    const tx = setup([medicalDocument], 1);

    const result = await listClinicalDocumentFeedPage('clinic-a', { kind: 'document' });

    expect(result.items[0]).toMatchObject({
      kind: 'document',
      label: 'Atestado',
      patientNome: 'Paciente 1',
      pdfHref: `/documentos/${medicalDocument.id}/pdf`,
      hasPdf: false,
    });
    expect(compile(tx.execute.mock.calls[0]?.[0]).sql).not.toContain('content_encrypted');
  });
});
