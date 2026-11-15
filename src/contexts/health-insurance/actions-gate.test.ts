/**
 * Toda server action de Convênios passa pelo portão (`gate()`: sessão, `manage:financial` e clínica
 * da sessão) antes de tocar o banco, direto ou por um helper local que o chama. Guarda estática da
 * P12.2: uma action nova sem portão reprova aqui, antes de existir teste de comportamento para ela.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/contexts/health-insurance/actions.ts'),
  'utf8',
);

/** Corpo de cada função de topo (do cabeçalho até a chave de fechamento na coluna 0). */
function topLevelFunctions(text: string): Map<string, { exported: boolean; body: string }> {
  const out = new Map<string, { exported: boolean; body: string }>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(export )?async function (\w+)/u.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j++;
    out.set(m[2]!, { exported: Boolean(m[1]), body: lines.slice(i, j + 1).join('\n') });
    i = j;
  }
  return out;
}

describe('portão das actions de Convênios (P12.2)', () => {
  const fns = topLevelFunctions(source);
  const gated = (name: string, seen = new Set<string>()): boolean => {
    const f = fns.get(name);
    if (!f || seen.has(name)) return false;
    seen.add(name);
    if (/\bgate\(\)|\bwrite\(/u.test(f.body)) return true;
    // Helper local que chama o portão (ex.: geração do documento da solicitação SP/SADT).
    return [...f.body.matchAll(/\b(\w+)\(/gu)].some(
      ([, callee]) => callee !== name && fns.has(callee!) && gated(callee!, seen),
    );
  };

  it('o portão exige sessão, gerenciar o financeiro e a clínica da sessão', () => {
    const gate = fns.get('gate')!.body;
    expect(gate).toMatch(/requireUser\(\)/u);
    expect(gate).toMatch(/requireCachedPermission\(PERMISSIONS\.MANAGE_FINANCIAL\)/u);
    expect(gate).toMatch(/requireClinicId\(\)/u);
    expect(fns.get('write')!.body).toMatch(/await gate\(\)/u);
  });

  /**
   * Exceções com portão próprio, cada uma com o motivo. A indicação clínica da solicitação SP/SADT
   * interna é escrita pela médica (`create:prontuario`), não pelo financeiro.
   */
  const OWN_GATE: Record<string, RegExp[]> = {
    setSadtClinicalIndicationAction: [
      /requireUser\(\)/u,
      /requireClinicId\(\)/u,
      /requireCachedPermission\(\s*kind === 'internal' \? PERMISSIONS\.CREATE_PRONTUARIO : PERMISSIONS\.MANAGE_FINANCIAL,?\s*\)/u,
    ],
  };

  it('toda action exportada passa pelo portão (ou pelo portão próprio listado, com o motivo)', () => {
    const actions = [...fns.entries()]
      .filter(([n, f]) => f.exported && n.endsWith('Action'))
      .map(([n]) => n);
    expect(actions.length).toBeGreaterThanOrEqual(40);
    expect(actions.filter((n) => !gated(n) && !OWN_GATE[n])).toEqual([]);
    for (const [name, checks] of Object.entries(OWN_GATE)) {
      const body = fns.get(name)?.body ?? '';
      for (const check of checks) expect(body, `${name}: ${String(check)}`).toMatch(check);
    }
  });
});
