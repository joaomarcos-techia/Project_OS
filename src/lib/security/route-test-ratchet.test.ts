/**
 * Catraca de handler HTTP (Fase 3 — "rota nova sem teste de tenant").
 *
 * A regra vale para o futuro de propósito: das 32 rotas existentes em
 * 2026-09-10, 9 tinham teste co-locado. Exigir teste das 32 hoje produziria 23
 * testes escritos às pressas ou uma allowlist de 23 linhas — nenhum dos dois é
 * gate. O que este teste prova é que a catraca gira nas duas direções e que ela
 * está de fato ligada ao `--check`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { routeTestDrift, type Inventory } from '../../../scripts/security/inventory-lib';

/** Inventário mínimo: a catraca só olha `kind: 'route'` e `file`. */
function inventoryOf(files: string[]): Inventory {
  return {
    surfaces: files.map((file) => ({
      id: `${file}#GET`,
      file,
      line: 1,
      name: 'GET',
      kind: 'route' as const,
      guard: 'session',
      evidence: [],
    })),
    props: [],
    environment: [],
    publicEnvironment: [],
  };
}

const ANTIGA = 'src/app/api/cron/outbox/route.ts';
/** Rota do baseline que JÁ tinha teste — a que a catraca protege. */
const COM_TESTE = 'src/app/api/webhooks/meta/route.ts';
const NOVA = 'src/app/api/pagamentos/estorno/route.ts';

describe('routeTestDrift', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qoro-route-ratchet-'));
    // Só a rota do baseline que tinha teste ganha o arquivo no fixture.
    const target = path.join(root, COM_TESTE.replace('route.ts', 'route.test.ts'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  });

  afterAll(() => {
    if (root && path.basename(root).startsWith('qoro-route-ratchet-')) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reprova rota NOVA sem teste co-locado', () => {
    const drift = routeTestDrift(root, inventoryOf([ANTIGA, NOVA]), inventoryOf([ANTIGA]));
    expect(drift.missingForNew).toEqual([NOVA]);
  });

  it('aprova rota nova QUE nasce com teste', () => {
    const comTeste = path.join(root, NOVA.replace('route.ts', 'route.test.ts'));
    fs.mkdirSync(path.dirname(comTeste), { recursive: true });
    fs.writeFileSync(comTeste, '');
    try {
      const drift = routeTestDrift(root, inventoryOf([ANTIGA, NOVA]), inventoryOf([ANTIGA]));
      expect(drift.missingForNew).toEqual([]);
    } finally {
      fs.rmSync(comTeste);
    }
  });

  it('não exige teste retroativo das rotas antigas que nunca tiveram', () => {
    // `ANTIGA` está no baseline e fora da lista fechada: a catraca a ignora.
    const drift = routeTestDrift(root, inventoryOf([ANTIGA]), inventoryOf([ANTIGA]));
    expect(drift).toEqual({ missingForNew: [], regressed: [] });
  });

  it('reprova quando uma rota PERDE o teste que já tinha', () => {
    // Sem esta direção, apagar o teste é o caminho mais curto para fugir da
    // primeira regra.
    const existente = path.join(root, COM_TESTE.replace('route.ts', 'route.test.ts'));
    const conteudo = fs.readFileSync(existente);
    fs.rmSync(existente);
    try {
      const drift = routeTestDrift(root, inventoryOf([COM_TESTE]), inventoryOf([COM_TESTE]));
      expect(drift.regressed).toEqual([COM_TESTE]);
    } finally {
      fs.writeFileSync(existente, conteudo);
    }
  });

  it('a rota do baseline com teste permanece aprovada', () => {
    const drift = routeTestDrift(root, inventoryOf([COM_TESTE]), inventoryOf([COM_TESTE]));
    expect(drift.regressed).toEqual([]);
  });
});

describe('gate: a catraca está ligada ao --check', () => {
  const runner = fs.readFileSync(path.join(process.cwd(), 'scripts/security/inventory.ts'), 'utf8');

  it('inventory.ts chama routeTestDrift e reprova nas duas direções', () => {
    expect(runner).toContain('routeTestDrift(root, current, before)');
    expect(runner).toContain('routeTests.missingForNew.length');
    expect(runner).toContain('routeTests.regressed.length');
  });

  it('as rotas que hoje têm teste continuam existindo no repositório', () => {
    // Se um destes arquivos for renomeado, a lista fechada vira letra morta em
    // silêncio: a rota some da lista e a catraca deixa de protegê-la.
    for (const route of [
      'src/app/api/webhooks/meta/route.ts',
      'src/app/api/webhooks/asaas/route.ts',
      'src/app/(app)/logout/route.ts',
    ]) {
      expect(
        fs.existsSync(path.join(process.cwd(), route.replace('route.ts', 'route.test.ts'))),
        `${route} perdeu o teste co-locado`,
      ).toBe(true);
    }
  });
});
