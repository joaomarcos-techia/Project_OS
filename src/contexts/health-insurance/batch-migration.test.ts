import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTenantPolicy } from '@/lib/db/rls';

const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const sqlText = read('0150_hi_batches.sql');
const statements = sqlText.replace(/--.*$/gmu, '');
const noBodies = statements.replace(/\$\$[\s\S]*?\$\$/gu, '');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const norm = (s: string): string =>
  s
    .replace(/public\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
const fnBody = (name: string): string =>
  sqlText.match(new RegExp(`FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'u'))![0];

const WRITERS = [
  'hi_batch_create',
  'hi_batch_validate',
  'hi_batch_export',
  'hi_batch_reopen',
  'hi_batch_mark_sent',
  'hi_batch_record_protocol',
  'hi_batch_mark_under_review',
  'hi_batch_record_return',
  'hi_batch_mark_processed',
  'hi_batch_cancel',
];

describe('migration 0150 — lotes TISS (P1.9)', () => {
  it('não toca tabela compartilhada nem apaga dado; só troca CHECKs de hi_files (0147, sem dado em lugar nenhum)', () => {
    expect(noBodies).not.toMatch(/\b(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|DROP\s+(?:TABLE|COLUMN|INDEX))\b/iu);
    expect(noBodies).not.toMatch(/ALTER TABLE public\.(?:appointments|lancamentos|patients)\b/u);
    const drops = [...noBodies.matchAll(/ALTER TABLE public\.(\w+) DROP CONSTRAINT (\w+);/gu)].map((m) => `${m[1]}.${m[2]}`);
    expect(drops).toEqual(['hi_files.hi_files_kind_chk', 'hi_files.hi_files_link_chk', 'hi_files.hi_files_media_chk']);
  });

  it('journal: idx 150 contíguo e `when` crescente', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0150_hi_batches');
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0149_hi_billing_gaps', 150]);
    expect(cur.when).toBeGreaterThan(prev.when);
  });

  it.each(['hi_batches', 'hi_batch_guides', 'hi_batch_events', 'hi_batch_returns'])(
    '%s: RLS literal do defaultTenantPolicy v2',
    (t) => {
      const expected = norm(defaultTenantPolicy(t).replace(/^-- GENERATED_BY.*\n/u, ''));
      expect(norm(statements.replace(/--> statement-breakpoint/gu, ''))).toContain(expected);
    },
  );

  it('runtime só lê; toda escrita pelas funções, que conferem a clínica da sessão', () => {
    expect(statements).toMatch(
      /GRANT SELECT ON public\.hi_batches, public\.hi_batch_guides, public\.hi_batch_events, public\.hi_batch_returns\s+TO authenticated, service_role;/u,
    );
    expect(statements).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*hi_batch/u);
    for (const f of WRITERS) {
      const body = fnBody(f);
      expect(body, f).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/u);
      expect(body, f).toMatch(/hi_session_clinic\(p_clinic_id\)|hi_batch_lock\(p_clinic_id/u);
    }
    expect(fnBody('hi_session_clinic')).toMatch(/current_setting\('app\.current_clinic', true\) IS DISTINCT FROM p_clinic_id::text/u);
  });

  it('regras do lote: 1 a 100 guias, mesma operadora, tipo e versão, só aprovadas, uma guia em um lote ativo', () => {
    expect(statements).toMatch(/guide_count BETWEEN 1 AND 100/u);
    expect(statements).toMatch(/CREATE UNIQUE INDEX hi_batch_guides_active_uniq ON public\.hi_batch_guides \(clinic_id, guide_id\) WHERE active;/u);
    const create = fnBody('hi_batch_create');
    expect(create).toMatch(/v_n = 0 OR v_n > 100/u);
    expect(create).toMatch(/WHEN insurer_id <> p_insurer_id THEN 'operadora'/u);
    expect(create).toMatch(/WHEN guide_type <> p_guide_type THEN 'tipo'/u);
    expect(create).toMatch(/WHEN tiss_version <> '4\.03\.00' THEN 'versão'/u);
    expect(create).toMatch(/status <> 'approved' OR NOT live OR approved_snapshot_id IS NULL/u);
    expect(create).toMatch(/ORDER BY id FOR UPDATE/u);
  });

  it('cada estado com a sua prova', () => {
    expect(fnBody('hi_batch_validate')).toMatch(/p_validation->>'xsd', ''\) <> 'valid'/u);
    expect(fnBody('hi_batch_validate')).toMatch(/approved_snapshot_id IS DISTINCT FROM bg\.snapshot_id/u);
    expect(fnBody('hi_batch_export')).toMatch(/v_file\.content_sha256 IS DISTINCT FROM v_batch\.content_sha256/u);
    expect(fnBody('hi_batch_mark_sent')).toMatch(/p_channel = 'manual' AND v_actor IS NULL/u);
    expect(statements).toMatch(/CREATE UNIQUE INDEX hi_batches_protocol_uniq ON public\.hi_batches \(clinic_id, insurer_id, protocol_number\)/u);
    expect(fnBody('hi_batch_mark_processed')).toMatch(/'analysis_statement', 'payment_statement', 'administrative_conference'/u);
    expect(statements).toMatch(/CONSTRAINT hi_batch_returns_once_uniq UNIQUE \(clinic_id, batch_id, kind, content_sha256\)/u);
    expect(fnBody('hi_batch_cancel')).toMatch(/v_batch\.status NOT IN \('prepared', 'validated', 'exported'\)/u);
  });

  it('defesa em profundidade: transições do lote fechadas e histórico/retornos imutáveis', () => {
    const t = fnBody('hi_batch_transition');
    expect(t).toMatch(/'prepared>validated', 'validated>exported', 'exported>sent', 'sent>received', 'received>under_review'/u);
    expect(statements).toMatch(/CREATE TRIGGER hi_batch_events_immutable BEFORE UPDATE ON public\.hi_batch_events/u);
    expect(statements).toMatch(/CREATE TRIGGER hi_batch_returns_immutable BEFORE UPDATE ON public\.hi_batch_returns/u);
  });

  it('arquivo do lote: só de lote validado e com o mesmo SHA-256 do conteúdo validado', () => {
    const f = fnBody('hi_guard_file');
    expect(f).toMatch(/NEW\.kind = 'batch_xml'/u);
    expect(f).toMatch(/v_batch\.status <> 'validated'/u);
    expect(f).toMatch(/v_prev\.batch_id IS DISTINCT FROM NEW\.batch_id/u);
  });
});
