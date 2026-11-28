import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { readPatientTissInventoryTx } from './retention-inventory';

const GUIDE = '11111111-1111-4111-8111-111111111111';

function fakeTx(results: unknown[][]): { tx: Tx; calls: number } {
  const state = { calls: 0 };
  const tx = {
    execute: vi.fn(async () => results[state.calls++] ?? []),
  } as unknown as Tx;
  return {
    tx,
    get calls() {
      return state.calls;
    },
  };
}

describe('inventário TISS por paciente (B6)', () => {
  it('mapeia guias, arquivos e carteirinhas só com metadados; arquivo de lote é compartilhado', async () => {
    const f = fakeTx([
      [
        {
          id: GUIDE,
          number: 'C0000001',
          guide_type: 'consulta',
          status: 'paid',
          insurer_id: 'ins-1',
          created_at: '2026-11-11T12:00:00Z',
          last_event: '2026-11-25T10:00:00Z',
        },
      ],
      [
        {
          id: 'f-1',
          kind: 'batch_xml',
          guide_id: null,
          batch_id: 'b-1',
          appeal_id: null,
          content_sha256: 'a'.repeat(64),
          size_bytes: 2048,
          created_at: '2026-11-11T12:05:00Z',
        },
      ],
      [{ id: 'm-1', insurer_id: 'ins-1', card_last4: '2345', status: 'active', linked: 1 }],
    ]);
    const inv = await readPatientTissInventoryTx(
      f.tx,
      'clinic-1',
      'patient-1',
      new Date('2026-11-25T12:00:00Z'),
    );
    expect(inv.guides).toHaveLength(1);
    expect(inv.guides[0]).toMatchObject({
      guideId: GUIDE,
      lastFinancialEventAt: '2026-11-25T10:00:00.000Z',
    });
    expect(inv.guides[0]!.retention).toMatchObject({
      status: 'dentro_do_prazo',
      descarteAutorizado: false,
      categoria: 'guia_tiss',
    });
    // marco = último evento financeiro (2026) → revisão só a partir de 01/01/2032
    expect(inv.guides[0]!.retention.elegivelEm?.slice(0, 10)).toBe('2032-01-01');
    expect(inv.files[0]).toMatchObject({ kind: 'batch_xml', shared: true, batchId: 'b-1' });
    expect(inv.memberships[0]).toEqual({
      membershipId: 'm-1',
      insurerId: 'ins-1',
      last4: '2345',
      status: 'active',
      linkedGuides: 1,
    });
    expect(Object.keys(inv.memberships[0]!)).not.toContain('cardNumber');
    expect(f.calls).toBe(3);
  });

  it('paciente sem guia: não consulta arquivos e devolve listas vazias', async () => {
    const f = fakeTx([[], []]);
    const inv = await readPatientTissInventoryTx(f.tx, 'clinic-1', 'patient-2');
    expect(inv).toEqual({ patientId: 'patient-2', guides: [], files: [], memberships: [] });
    expect(f.calls).toBe(2);
  });

  it('sem evento financeiro, o marco é a criação da guia', async () => {
    const f = fakeTx([
      [
        {
          id: GUIDE,
          number: 'C1',
          guide_type: 'consulta',
          status: 'issued',
          insurer_id: 'i',
          created_at: '2025-03-01T00:00:00Z',
          last_event: null,
        },
      ],
      [],
      [],
    ]);
    const inv = await readPatientTissInventoryTx(f.tx, 'c', 'p', new Date('2031-06-01T00:00:00Z'));
    expect(inv.guides[0]!.lastFinancialEventAt).toBeNull();
    expect(inv.guides[0]!.retention.elegivelEm?.slice(0, 10)).toBe('2031-01-01');
    expect(inv.guides[0]!.retention).toMatchObject({
      status: 'revisao_humana',
      descarteAutorizado: false,
    });
  });
});
