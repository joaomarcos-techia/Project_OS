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
    expect(source).toContain("- l.due_date) >= 3");
    expect(source).not.toContain('BETWEEN 3 AND 30');
  });
});
