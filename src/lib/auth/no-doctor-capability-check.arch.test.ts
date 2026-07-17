/**
 * Arch-test (review #11 do founder): depois da migração do ADR-032 §2, capacidade
 * clínica é `isPractitioner` — ninguém mais deve escrever `role === 'doctor'` /
 * `role !== 'doctor'` como gate em código. Este teste varre `src/**` (código, não
 * comentários) e falha se o check reaparecer fora do próprio predicado.
 *
 * Precedente de arch-test no repo: critical-actions.test.ts (AST) e rls.test.ts (grep).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

// Único lugar onde `role === 'doctor'` é legítimo: a definição do predicado (a
// cláusula de role) e o curto-circuito do serviço que a espelha.
const ALLOWLIST = new Set([
  join('src', 'lib', 'auth', 'practitioner.ts'),
  join('src', 'contexts', 'identity', 'internal', 'practitioner.ts'),
]);

const DOCTOR_CHECK = /(===|!==)\s*['"]doctor['"]/;

/** Remove comentários de bloco e de linha — o check só importa em CÓDIGO. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("arch: nenhum `role === 'doctor'` fora do predicado (ADR-032 §2)", () => {
  it('capacidade clínica só via isPractitioner / getCurrentPractitioner / practitionerSql', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(process.cwd().length + 1);
      if (ALLOWLIST.has(rel)) continue;
      if (DOCTOR_CHECK.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
    }
    expect(
      offenders,
      `Use isPractitioner (@/lib/auth/practitioner) — ADR-032 §2. Ofensores:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
