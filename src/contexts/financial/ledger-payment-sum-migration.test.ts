import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * R38 (0155): a soma de pagamentos do gatilho do livro passa a filtrar pela clínica. Prova
 * estática de que a função é a da 0153 com UMA condição a mais e nada além disso; a prova de
 * comportamento (antes = depois) e de desempenho está nos harnesses
 * `scripts/security/hi-r38-ledger-equivalence-db.ts` e `hi-r38-ledger-trigger-bench.ts`.
 */
const read = (f: string): string => readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const m0155 = read('0155_ledger_payment_sum_by_clinic.sql');
const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; when: number; tag: string }> };
const fnText = (text: string): string => {
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.validate_payment_transaction_insert()');
  return text.slice(start, text.indexOf('END $$;', start) + 'END $$;'.length);
};
// Comentários fora; o separador `--> statement-breakpoint` fica.
const stripComments = (s: string): string => s.replace(/^\s*--(?!>).*\n/gmu, '');

describe('migration 0155 — soma de pagamentos do livro pela clínica (R38)', () => {
  it('journal: idx 155 contíguo, depois da 0154, `when` crescente', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0155_ledger_payment_sum_by_clinic');
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0154_hi_premium_period_evidence', 155]);
    expect(cur.when).toBeGreaterThan(prev.when);
  });

  it('só troca a função (nenhuma tabela, índice, gatilho ou grant novo) e registra a versão', () => {
    const statements = stripComments(m0155)
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE OR REPLACE FUNCTION public\.validate_payment_transaction_insert\(\)/u);
    expect(statements[1]).toBe('REVOKE ALL ON FUNCTION public.validate_payment_transaction_insert() FROM PUBLIC, anon, authenticated;');
    expect(statements[2]).toMatch(/^INSERT INTO public\._schema_version \(version\) VALUES \('0155-ledger-payment-sum-by-clinic'\)/u);
    expect(stripComments(m0155).replace(/\$\$[\s\S]*?\$\$/gu, '')).not.toMatch(/\b(?:ALTER|CREATE (?:UNIQUE )?INDEX|CREATE TRIGGER|DROP|GRANT|TRUNCATE|DELETE|UPDATE)\b/u);
  });

  it('corpo = o da 0153 com exatamente `clinic_id = NEW.clinic_id` na soma do caminho particular', () => {
    const f0153 = fnText(read('0153_hi_ledger_bridge.sql'));
    const f0155 = stripComments(fnText(m0155));
    const restored = f0155.replace(
      "     WHERE clinic_id = NEW.clinic_id\n       AND lancamento_id = NEW.lancamento_id\n       AND kind = 'payment';",
      "     WHERE lancamento_id = NEW.lancamento_id\n       AND kind = 'payment';",
    );
    expect(restored).not.toBe(f0155);
    expect(restored).toBe(stripComments(f0153));
  });

  it('a condição só entra DEPOIS da conferência de que o lançamento é da mesma clínica', () => {
    const f = fnText(m0155);
    const guard = f.indexOf("RAISE EXCEPTION 'payment transaction must reference a lancamento from the same clinic'");
    const sum = f.indexOf('WHERE clinic_id = NEW.clinic_id\n       AND lancamento_id = NEW.lancamento_id');
    expect(guard).toBeGreaterThan(0);
    expect(sum).toBeGreaterThan(guard);
    // o estorno continua pela soma do pagamento original (índice próprio), sem mudança
    expect(f).toMatch(/WHERE original_payment_id = NEW\.original_payment_id\n {5}AND kind = 'refund';/u);
  });
});
