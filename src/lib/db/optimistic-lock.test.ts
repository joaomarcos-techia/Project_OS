/**
 * REGRESSION (E2E de produção, 2026-08-16) — o compare-and-swap por `updated_at`
 * nunca casava.
 *
 * `timestamptz` guarda MICROSSEGUNDOS; o valor viaja até o formulário como
 * ISO-8601, que só tem MILISSEGUNDOS. Comparar com `=` compara `…471227` com
 * `…471000` — nunca igual. Efeito observado em produção: as duas escritas
 * concorrentes falharam (o correto é uma vencer) e, pior, QUALQUER edição
 * isolada falharia, porque o defeito depende só do round-trip.
 *
 * Amostra real de `patients.updated_at` na produção no dia do achado: 28 de 28
 * linhas com precisão sub-milissegundo. Ou seja, a taxa de falha era 100%.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const helper = read('src/lib/db/optimistic-lock.ts');

const CAS_SITES = [
  'src/contexts/patient/actions.ts',
  'src/contexts/financial/actions.ts',
  'src/contexts/tenancy/internal/profile-core.ts',
];

describe('matchesExpectedVersion — a comparação sobrevive ao round-trip', () => {
  it('trunca os DOIS lados ao milissegundo', () => {
    // Truncar só um lado deixaria a comparação assimétrica e igualmente quebrada.
    expect(helper).toContain("date_trunc('milliseconds'");
    expect(helper.match(/date_trunc\('milliseconds'/gu)).toHaveLength(2);
  });

  it('o valor esperado é tipado como timestamptz', () => {
    // Sem o cast, o Postgres compara com `timestamp without time zone` e o
    // resultado passa a depender do fuso da sessão.
    expect(helper).toContain('::timestamptz');
  });

  it('demonstra a perda de precisão que causou o achado', () => {
    // É o round-trip real: Postgres → driver → ISO → new Date().
    const comMicros = '2026-08-13T22:45:49.471227Z';
    const round = new Date(comMicros).toISOString();
    expect(round).toBe('2026-08-13T22:45:49.471Z');
    // A igualdade estrita que o código usava é justamente esta comparação.
    expect(round).not.toBe(comMicros);
  });
});

describe('nenhum call-site voltou a comparar com igualdade estrita', () => {
  it.each(CAS_SITES)('%s usa o helper', (path) => {
    const source = read(path);
    expect(source).toContain('matchesExpectedVersion(');
  });

  it.each(CAS_SITES)('%s não compara updatedAt com eq(...new Date(...))', (path) => {
    const source = read(path);
    // A linha exata que quebrou, em três arquivos (era cópia).
    expect(source).not.toMatch(/eq\(\s*\w+\.updatedAt,\s*new Date\(/u);
  });

  it('a regra vive num lugar só', () => {
    // Três cópias divergiriam; foi assim que o defeito nasceu igual nos três.
    expect(helper).toContain('export function matchesExpectedVersion');
  });
});

describe('o contrato de detecção de escrita obsoleta continua de pé', () => {
  it('paciente, fornecedor e perfil ainda lançam quando a versão não bate', () => {
    expect(read('src/contexts/patient/actions.ts')).toContain('StaleWriteError');
    // O fornecedor sinaliza obsolescência com FinancialValidationError, não
    // com uma classe dedicada — o contrato é a recusa, não o nome.
    const financial = read('src/contexts/financial/actions.ts');
    const supplierBlock = financial.slice(
      financial.indexOf('matchesExpectedVersion(suppliers.updatedAt'),
    );
    expect(supplierBlock.slice(0, 600)).toContain('FinancialValidationError');
    expect(read('src/contexts/tenancy/internal/profile-core.ts')).toContain(
      'StaleClinicProfileError',
    );
  });

  it('a checagem continua condicionada ao envio da versão esperada', () => {
    // Sem `expectedUpdatedAt` no formulário não há CAS — e não pode haver falha.
    expect(read('src/contexts/patient/actions.ts')).toContain('data.expectedUpdatedAt');
  });
});
