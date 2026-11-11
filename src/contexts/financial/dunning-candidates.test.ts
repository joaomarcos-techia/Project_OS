import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/contexts/financial/dunning-candidates.ts'),
  'utf8',
);

describe('dunning candidate query', () => {
  it('inclui parcelas pelo saldo residual e nao descarta dividas antigas', () => {
    expect(source).toContain("l.status IN ('pendente', 'parcial')");
    expect(source).toContain('(l.valor - l.valor_pago)');
    expect(source).toContain('- l.due_date) >= 3');
    expect(source).not.toContain('BETWEEN 3 AND 30');
  });

  // Caracterização (P14.1 do QORO_TISS_MASTER_PLAN.md): a régua só cobra
  // recebível de PACIENTE. O recebível de operadora de convênio nasce sem
  // `patient_id` (ADR-072) e depende desta regra para nunca virar cobrança ao
  // paciente. Se este teste quebrar, a premissa do convênio quebrou junto.
  it('só cobra recebível a receber que tem paciente', () => {
    expect(source).toContain("l.tipo = 'receber'");
    expect(source).toContain('l.patient_id IS NOT NULL');
    expect(source).toContain('JOIN patients p ON p.id = l.patient_id');
  });
});
