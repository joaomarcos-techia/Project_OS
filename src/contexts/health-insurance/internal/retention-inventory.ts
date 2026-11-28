/**
 * Inventário TISS por paciente (B6): o que o Convênios guarda de um paciente, onde está e em que ponto do prazo
 * de retenção cada documento se encontra. Serve ao pedido de ACESSO do titular (LGPD art. 18, II; RN ANS 501,
 * art. 20) e à revisão humana de retenção. SÓ LEITURA, só metadados: nenhum conteúdo de guia, nenhum número de
 * carteirinha, nenhum byte de arquivo. Roda na sessão da clínica (RLS): outra clínica não vê nada.
 *
 * A classificação vem de `simulateRetention`, que nunca autoriza descarte.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { simulateRetention, type SimulationResult } from '@/lib/compliance/retention-catalog';

export interface InventoryGuide {
  guideId: string;
  number: string;
  guideType: string;
  status: string;
  insurerId: string;
  createdAt: string;
  /** Último evento financeiro da guia (pagamento, glosa, recurso); marco do prazo de retenção. */
  lastFinancialEventAt: string | null;
  retention: SimulationResult;
}

export interface InventoryFile {
  fileId: string;
  kind: string;
  guideId: string | null;
  batchId: string | null;
  appealId: string | null;
  /** Arquivo de lote ou recurso: contém dados de outros beneficiários do mesmo lote. */
  shared: boolean;
  contentSha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface InventoryMembership {
  membershipId: string;
  insurerId: string;
  last4: string;
  status: string;
  linkedGuides: number;
}

export interface PatientTissInventory {
  patientId: string;
  guides: InventoryGuide[];
  files: InventoryFile[];
  memberships: InventoryMembership[];
}

const iso = (v: unknown) =>
  v instanceof Date
    ? v.toISOString()
    : v === null || v === undefined
      ? null
      : new Date(String(v)).toISOString();

export async function readPatientTissInventoryTx(
  tx: Tx,
  clinicId: string,
  patientId: string,
  now: Date = new Date(),
): Promise<PatientTissInventory> {
  const guides = (await tx.execute(sql`
    SELECT g.id, g.number, g.guide_type, g.status, g.insurer_id, g.created_at,
           (SELECT max(e.created_at) FROM public.hi_account_events e
             WHERE e.clinic_id = g.clinic_id AND (e.guide_id = g.id
               OR e.gloss_id IN (SELECT gl.id FROM public.hi_glosses gl WHERE gl.clinic_id = g.clinic_id AND gl.guide_id = g.id)
               OR e.payment_id IN (SELECT a.payment_id FROM public.hi_payment_allocations a WHERE a.clinic_id = g.clinic_id AND a.guide_id = g.id))) AS last_event
      FROM public.hi_guides g
     WHERE g.clinic_id = ${clinicId}::uuid AND g.patient_id = ${patientId}::uuid
     ORDER BY g.created_at`)) as unknown as Array<Record<string, unknown>>;
  const guideIds = guides.map((g) => String(g.id));

  const files = guideIds.length
    ? ((await tx.execute(sql`
        SELECT f.id, f.kind, f.guide_id, f.batch_id, f.appeal_id, f.content_sha256, f.size_bytes, f.created_at
          FROM public.hi_files f
         WHERE f.clinic_id = ${clinicId}::uuid AND (
               f.guide_id = ANY(ARRAY[${guideIds}]::uuid[])
            OR f.batch_id IN (SELECT bg.batch_id FROM public.hi_batch_guides bg WHERE bg.clinic_id = ${clinicId}::uuid AND bg.guide_id = ANY(ARRAY[${guideIds}]::uuid[]))
            OR f.appeal_id IN (SELECT ap.id FROM public.hi_gloss_appeals ap WHERE ap.clinic_id = ${clinicId}::uuid AND ap.guide_id = ANY(ARRAY[${guideIds}]::uuid[])))
         ORDER BY f.created_at`)) as unknown as Array<Record<string, unknown>>)
    : [];

  const memberships = (await tx.execute(sql`
    SELECT m.id, m.insurer_id, m.card_last4, m.status,
           (SELECT count(*)::int FROM public.hi_guides g WHERE g.clinic_id = m.clinic_id AND g.membership_id = m.id) AS linked
      FROM public.hi_memberships m
     WHERE m.clinic_id = ${clinicId}::uuid AND m.patient_id = ${patientId}::uuid
     ORDER BY m.created_at`)) as unknown as Array<Record<string, unknown>>;

  const retention = simulateRetention(
    guides.map((g) => ({
      ref: String(g.id),
      categoria: 'guia_tiss' as const,
      marco: new Date(String(g.last_event ?? g.created_at)),
    })),
    now,
  );

  return {
    patientId,
    guides: guides.map((g, i) => ({
      guideId: String(g.id),
      number: String(g.number),
      guideType: String(g.guide_type),
      status: String(g.status),
      insurerId: String(g.insurer_id),
      createdAt: iso(g.created_at)!,
      lastFinancialEventAt: iso(g.last_event),
      retention: retention[i]!,
    })),
    files: files.map((f) => ({
      fileId: String(f.id),
      kind: String(f.kind),
      guideId: f.guide_id === null ? null : String(f.guide_id),
      batchId: f.batch_id === null ? null : String(f.batch_id),
      appealId: f.appeal_id === null ? null : String(f.appeal_id),
      shared: f.batch_id !== null || f.appeal_id !== null,
      contentSha256: String(f.content_sha256),
      sizeBytes: Number(f.size_bytes),
      createdAt: iso(f.created_at)!,
    })),
    memberships: memberships.map((m) => ({
      membershipId: String(m.id),
      insurerId: String(m.insurer_id),
      last4: String(m.card_last4),
      status: String(m.status),
      linkedGuides: Number(m.linked),
    })),
  };
}
