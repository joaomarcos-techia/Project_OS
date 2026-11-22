/**
 * Toda server action de Convênios passa pelo portão (`gate(regra)`: sessão, QUALQUER código da regra
 * da matriz I.2 e clínica da sessão) antes de tocar o banco, direto ou por um helper local que o
 * chama. Guarda estática da P12.2/P1.12-b: uma action nova sem portão reprova aqui, e um evento de
 * auditoria sem regra em `rights.ts` também (falha fechada no servidor).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CONVENIOS_RULES } from './rights';
import { ruleForAuditAction } from './rights';

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

describe('portão das actions de Convênios (P12.2, matriz I.2)', () => {
  const fns = topLevelFunctions(source);
  const gated = (name: string, seen = new Set<string>()): boolean => {
    const f = fns.get(name);
    if (!f || seen.has(name)) return false;
    seen.add(name);
    if (/\bgate\('|\bwrite\(/u.test(f.body)) return true;
    // Helper local que chama o portão (ex.: geração do documento da solicitação SP/SADT).
    return [...f.body.matchAll(/\b(\w+)\(/gu)].some(
      ([, callee]) => callee !== name && fns.has(callee!) && gated(callee!, seen),
    );
  };

  it('o portão exige sessão, um código da regra e a clínica da sessão; a escrita deriva a regra do evento', () => {
    const gate = fns.get('gate')!.body;
    expect(gate).toMatch(/requireUser\(\)/u);
    expect(gate).toMatch(/requireCachedAnyPermission\(CONVENIOS_RULES\[rule\]\)/u);
    expect(gate).toMatch(/requireClinicId\(\)/u);
    expect(fns.get('write')!.body).toMatch(/await gate\(ruleForAuditAction\(action\)\)/u);
    // Nenhuma action volta ao portão antigo (gerenciar o financeiro para tudo).
    expect(source).not.toMatch(/requireCachedPermission\(PERMISSIONS\.MANAGE_FINANCIAL\)/u);
  });

  /**
   * Exceções com portão próprio, cada uma com o motivo. A indicação clínica da solicitação SP/SADT
   * interna é escrita pela médica (`create:prontuario`, só na própria solicitação sem visão ampla);
   * a externa, pela recepção (`operate:convenios`).
   */
  const OWN_GATE: Record<string, RegExp[]> = {
    setSadtClinicalIndicationAction: [
      /requireUser\(\)/u,
      /requireCachedPermission\(PERMISSIONS\.VIEW_CONVENIOS\)/u,
      /requireClinicId\(\)/u,
      /req\.requester !== user\.userId/u,
      /requireCachedPermission\(\s*kind === 'internal' \? PERMISSIONS\.CREATE_PRONTUARIO : PERMISSIONS\.OPERATE_CONVENIOS,?\s*\)/u,
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

  it('todo evento de auditoria escrito pelas actions tem regra (falha fechada para evento novo)', () => {
    const events = [
      ...source.matchAll(/write\(\s*['`](health_insurance\.[a-z_.${}]+)['`]/gu),
    ].map((m) => m[1]!.replace(/\$\{[^}]+\}/u, 'x'));
    expect(events.length).toBeGreaterThanOrEqual(30);
    for (const e of events) expect(() => ruleForAuditAction(e), e).not.toThrow();
    expect(() => ruleForAuditAction('health_insurance.novo.evento')).toThrow(/sem regra/u);
  });

  it('as regras das escritas seguem a matriz aprovada (D-1, D-2, 4.2, 4.3)', () => {
    const expected: Record<string, keyof typeof CONVENIOS_RULES> = {
      'health_insurance.guide.reviewed': 'operateOrBill',
      'health_insurance.guide.returned': 'operateOrBill',
      'health_insurance.guide.consulta_fields_updated': 'operateOrBill',
      // P8.4: completar os itens executados na conferência é como corrigir a guia.
      'health_insurance.extra_item.recorded': 'operateOrBill',
      'health_insurance.extra_item.cancelled': 'operateOrBill',
      'health_insurance.guide.cancelled': 'bill',
      'health_insurance.guide.reconciled': 'bill',
      'health_insurance.batch.created': 'bill',
      'health_insurance.gloss.recorded': 'bill',
      'health_insurance.appeal.filed': 'bill',
      'health_insurance.payment.allocated': 'bill',
      'health_insurance.payout.settled': 'bill',
      'health_insurance.payout.synced': 'bill',
      // D-2: política de repasse é da administração, não do faturamento.
      'health_insurance.payout.policy_changed': 'configure',
      'health_insurance.sadt_request.created': 'operate',
      'health_insurance.authorization.response_recorded': 'operate',
      'health_insurance.copay.charge_synced': 'patientCharge',
    };
    for (const [event, rule] of Object.entries(expected)) expect(ruleForAuditAction(event), event).toBe(rule);
  });

  it('aprovar e exportar o lote conferem a permissão FRESCA de faturar (matriz 4.3)', () => {
    for (const name of ['approveGuideAction', 'exportBatchAction']) {
      const body = fns.get(name)!.body;
      expect(body, name).toMatch(/gate\('bill'\)/u);
      expect(body, name).toMatch(/requireFreshPermission\(PERMISSIONS\.MANAGE_FATURAMENTO_CONVENIO\)/u);
    }
    expect(fns.get('requestCopayChargeAction')!.body).toMatch(/gate\('patientCharge'\)/u);
  });
});
