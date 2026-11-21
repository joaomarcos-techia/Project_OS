/**
 * P6.4 — porta do conector e adaptador manual (padrão e completo), sem operadora real: o manual
 * nunca diz "enviado"/"autorizado"; cada operação aponta uma tela e uma ação que EXISTEM; sem
 * homologação (inclusive com credencial guardada) é manual; o eletrônico que não responde volta
 * ao manual sem estado falso; pedido de outra operadora não é transmitido.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ConnectorOutcome } from '../../tiss/connector/connector';

import { createManualAdapter, manualInstructions } from './manual-adapter';
import { OPERATOR_OPERATIONS, type OperatorRequest } from './operator-connector';
import {
  NO_HOMOLOGATED_OPERATORS,
  resolveOperatorConnector,
  type HomologatedTransport,
} from './resolve-connector';

const INSURER = 'ins-a';
const req = (operation: OperatorRequest['operation'], over: Partial<OperatorRequest> = {}): OperatorRequest => ({
  operation,
  insurerId: INSURER,
  subjectId: '11111111-1111-4111-8111-111111111111',
  xml: new TextEncoder().encode('<mensagemTISS>conteudo-sigiloso</mensagemTISS>'),
  idempotencyKey: 'lote-1:v1',
  ...over,
});

const CONVENIOS = join(process.cwd(), 'src', 'app', '(app)', '(shell)', 'convenios');
function allSources(dir: string): string {
  let text = '';
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) text += allSources(p);
    else if (/\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name)) text += readFileSync(p, 'utf8');
  }
  return text;
}

describe('adaptador manual (P6.4)', () => {
  it('toda operação é manual, com passos e o lugar do registro; nunca resultado eletrônico', async () => {
    const manual = createManualAdapter();
    expect(manual.id).toBe('manual');
    for (const operation of OPERATOR_OPERATIONS) {
      const out = await manual.perform(req(operation));
      expect(out.kind, operation).toBe('manual');
      if (out.kind !== 'manual') continue;
      expect(out.reason).toBe('not_homologated');
      expect(out.steps.length).toBeGreaterThan(0);
      expect(out.recordIn.path.startsWith('/convenios')).toBe(true);
      expect(out.recordIn.action.length).toBeGreaterThan(3);
      // Nada do conteúdo enviado nem da chave volta no resultado (vai para tela e log).
      expect(JSON.stringify(out)).not.toMatch(/conteudo-sigiloso|lote-1:v1/u);
    }
  });

  it('as telas e ações apontadas existem no módulo (contrato com as rotas e os textos atuais)', () => {
    const sources = allSources(CONVENIOS);
    for (const operation of OPERATOR_OPERATIONS) {
      const { recordIn } = manualInstructions(operation);
      const dir = join(CONVENIOS, ...recordIn.path.replace(/^\/convenios\/?/u, '').split('/').filter(Boolean));
      expect(existsSync(join(dir, 'page.tsx')), `${operation}: rota ${recordIn.path}`).toBe(true);
      expect(sources.includes(recordIn.action), `${operation}: ação "${recordIn.action}"`).toBe(true);
    }
  });

  it('o objeto da operação entra no caminho da tela (lote, solicitação, guia)', () => {
    expect(manualInstructions('submit_batch', 'b1').recordIn.path).toBe('/convenios/lotes/b1');
    expect(manualInstructions('request_authorization', 'r1').recordIn.path).toBe('/convenios/solicitacoes/r1');
    expect(manualInstructions('submit_appeal', 'g1').recordIn.path).toBe('/convenios/guias/g1');
    expect(manualInstructions('statement', 'x').recordIn.path).toBe('/convenios/conciliacao');
  });
});

describe('seleção do adaptador (P6.4)', () => {
  function transport(outcomes: ConnectorOutcome[], operations = ['submit_batch'] as const) {
    let i = 0;
    const submit = vi.fn(async () => outcomes[Math.min(i++, outcomes.length - 1)]!);
    const t: HomologatedTransport = { id: 'tiss-soap-ins-a', operations: new Set(operations), submit };
    return { t, submit };
  }

  it('sem homologação é manual; credencial guardada não liga o envio (só muda o motivo)', async () => {
    const plain = resolveOperatorConnector({ insurerId: INSURER, registry: NO_HOMOLOGATED_OPERATORS, hasActiveCredential: false });
    const withCredential = resolveOperatorConnector({ insurerId: INSURER, registry: NO_HOMOLOGATED_OPERATORS, hasActiveCredential: true });
    expect(plain.id).toBe('manual');
    expect(await plain.perform(req('submit_batch'))).toMatchObject({ kind: 'manual', reason: 'not_homologated' });
    expect(await withCredential.perform(req('submit_batch'))).toMatchObject({ kind: 'manual', reason: 'credential_without_homologation' });
  });

  it('homologado: protocolo da operadora volta como está; recusa dela também (sem repetir aqui)', async () => {
    const ok = transport([{ kind: 'accepted', protocol: 'P-123' }]);
    const c = resolveOperatorConnector({ insurerId: INSURER, registry: new Map([[INSURER, ok.t]]), hasActiveCredential: true });
    expect(await c.perform(req('submit_batch'))).toEqual({
      kind: 'electronic',
      operation: 'submit_batch',
      outcome: { kind: 'accepted', protocol: 'P-123' },
    });
    const no = transport([{ kind: 'rejected', code: '5001', message: 'guia duplicada' }]);
    const c2 = resolveOperatorConnector({ insurerId: INSURER, registry: new Map([[INSURER, no.t]]), hasActiveCredential: true });
    expect(await c2.perform(req('submit_batch'))).toMatchObject({ kind: 'electronic', outcome: { kind: 'rejected' } });
    expect(no.submit).toHaveBeenCalledTimes(1);
  });

  it('fora do ar, circuito aberto ou sem configuração: volta ao manual com o motivo, sem "enviado"', async () => {
    for (const outcome of [
      { kind: 'unavailable', reason: 'timeout' },
      { kind: 'circuit_open', retryAfterMs: 1000 },
      { kind: 'not_configured' },
    ] as ConnectorOutcome[]) {
      const x = transport([outcome]);
      const c = resolveOperatorConnector({ insurerId: INSURER, registry: new Map([[INSURER, x.t]]), hasActiveCredential: true });
      expect(await c.perform(req('submit_batch'))).toMatchObject({
        kind: 'manual',
        reason: 'connector_unavailable',
        recordIn: { action: 'Marcar como enviado' },
      });
    }
  });

  it('operação não homologada com esta operadora segue manual, sem chamar o transporte', async () => {
    const x = transport([{ kind: 'accepted', protocol: 'P-1' }], ['submit_batch']);
    const c = resolveOperatorConnector({ insurerId: INSURER, registry: new Map([[INSURER, x.t]]), hasActiveCredential: true });
    expect(await c.perform(req('statement'))).toMatchObject({ kind: 'manual', operation: 'statement' });
    expect(x.submit).not.toHaveBeenCalled();
  });

  it('pedido de outra operadora não é transmitido pelo adaptador desta; outra operadora sem homologação é manual', async () => {
    const x = transport([{ kind: 'accepted', protocol: 'P-1' }]);
    const c = resolveOperatorConnector({ insurerId: INSURER, registry: new Map([[INSURER, x.t]]), hasActiveCredential: true });
    await expect(c.perform(req('submit_batch', { insurerId: 'ins-b' }))).rejects.toThrow(/operadora do pedido/u);
    expect(x.submit).not.toHaveBeenCalled();
    const other = resolveOperatorConnector({ insurerId: 'ins-b', registry: new Map([[INSURER, x.t]]), hasActiveCredential: false });
    expect(other.id).toBe('manual');
  });
});
