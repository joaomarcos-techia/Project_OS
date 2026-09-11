/**
 * Teto de custo do agente por clínica (auditoria 2026-09-10, item 11).
 *
 * O SQL é montado pelo Drizzle real e inspecionado pelo dialect — o teste
 * verifica a cláusula que de fato iria ao Postgres, não uma string escrita à
 * mão. O que ele NÃO prova: o comportamento do banco com dados reais e a
 * corrida entre turnos paralelos (limite documentado em quota.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { AI_COST_WINDOW_MINUTES, MAX_AI_COST_USD_PER_CLINIC_WINDOW } from '../limits';

import { checkQuota } from './quota';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();

/**
 * Tx sintética: devolve `spend` como o driver devolve `numeric` (string) e
 * guarda a cláusula WHERE para inspeção.
 */
function fakeTx(spend: string) {
  const capture: { where: SQL | null } = { where: null };
  const query: Record<string, unknown> = {};
  query.from = vi.fn(() => query);
  query.where = vi.fn((clause: SQL) => {
    capture.where = clause;
    return query;
  });
  query.then = (resolve: (value: unknown) => unknown) => resolve([{ spend }]);
  return { tx: { select: vi.fn(() => query) } as never, capture };
}

describe('checkQuota — teto por clínica na janela', () => {
  it('libera quando o gasto está abaixo do teto', async () => {
    const { tx } = fakeTx('0.253000');
    await expect(checkQuota(tx, CLINIC_ID)).resolves.toEqual({
      blocked: false,
      spendUsd: 0.253,
      limitUsd: MAX_AI_COST_USD_PER_CLINIC_WINDOW,
      windowMinutes: AI_COST_WINDOW_MINUTES,
    });
  });

  it('bloqueia exatamente NO teto, não só acima', async () => {
    // `>=`: bater no limite já é o limite. Com `>`, o turno que fecha a conta
    // passa e o teto vira "teto + um turno".
    const { tx } = fakeTx(String(MAX_AI_COST_USD_PER_CLINIC_WINDOW));
    await expect(checkQuota(tx, CLINIC_ID)).resolves.toMatchObject({ blocked: true });
  });

  it('bloqueia acima do teto', async () => {
    const { tx } = fakeTx(String(MAX_AI_COST_USD_PER_CLINIC_WINDOW * 3));
    const result = await checkQuota(tx, CLINIC_ID);
    expect(result.blocked).toBe(true);
    expect(result.spendUsd).toBe(MAX_AI_COST_USD_PER_CLINIC_WINDOW * 3);
  });

  it('trata a ausência de mensagens como gasto zero, não como bloqueio', async () => {
    // COALESCE devolve '0'; um NULL virando NaN bloquearia o agente inteiro
    // justamente na clínica que nunca usou a IA.
    const { tx } = fakeTx('0');
    await expect(checkQuota(tx, CLINIC_ID)).resolves.toMatchObject({
      blocked: false,
      spendUsd: 0,
    });
  });

  it('filtra por clínica E pela janela — não soma o mês nem outro tenant', async () => {
    const { tx, capture } = fakeTx('0');
    await checkQuota(tx, CLINIC_ID);

    expect(capture.where).not.toBeNull();
    const { sql: text, params } = dialect.sqlToQuery(capture.where as SQL);
    // Escopo do tenant: o id entra por parâmetro, nunca interpolado.
    expect(params).toContain(CLINIC_ID);
    expect(text).toContain('clinic_id');
    // Janela deslizante sobre a partition key, com o tamanho vindo da constante.
    expect(text).toContain('created_at');
    expect(text).toContain('now()');
    expect(text).toContain('minutes');
    expect(params).toContain(AI_COST_WINDOW_MINUTES);
    // Regressão do placeholder anterior, que somava o mês inteiro.
    expect(text).not.toContain('date_trunc');
  });

  it('o teto é uma constante congelada, não configuração de clínica', () => {
    // Se este valor virar leitura de env/banco, o teste falha e a discussão
    // acontece no PR — que é o ponto do orçamento congelado do ADR-022.
    expect(MAX_AI_COST_USD_PER_CLINIC_WINDOW).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_AI_COST_USD_PER_CLINIC_WINDOW)).toBe(true);
    expect(AI_COST_WINDOW_MINUTES).toBe(60);
  });
});

/**
 * Gate de ligação. O achado original não foi só "o teto devolve Infinity": foi
 * que `checkQuota` não tinha **nenhum caller** no repositório. Um teto perfeito
 * que ninguém chama protege exatamente nada, e essa é a regressão mais fácil de
 * reintroduzir sem que teste unitário algum perceba.
 */
describe('gate: o teto está de fato ligado ao turno', () => {
  const handler = fs.readFileSync(
    path.join(process.cwd(), 'src/contexts/ai-agent/internal/handlers/inbound-received.ts'),
    'utf8',
  );

  it('o handler do turno chama checkQuota', () => {
    expect(handler).toContain("from '../quota'");
    expect(handler).toMatch(/checkQuota\(tx, clinicId\)/);
  });

  it('o bloqueio produz o outcome quota_blocked', () => {
    expect(handler).toContain("'quota_blocked'");
    expect(handler).toContain("metrics.emit('ai_agent.quota.blocked'");
  });

  it('a verificação precede a chamada ao provider', () => {
    // Se o teto rodasse depois do `new GeminiProvider()`, o turno já teria
    // gastado — o bloqueio seria contabilidade, não contenção.
    const quotaAt = handler.indexOf('await quotaExceeded()');
    const providerAt = handler.indexOf('new GeminiProvider()');
    expect(quotaAt).toBeGreaterThan(0);
    expect(providerAt).toBeGreaterThan(0);
    expect(quotaAt).toBeLessThan(providerAt);
  });

  it('o ramo bloqueado responde fallback e escalona, sem prompt nem tool', () => {
    // Só o corpo do ramo de quota: do predicado até o `} else {` que abre a
    // FASE B. Fatiar até o provider arrastaria a FASE B inteira para dentro.
    const start = handler.indexOf('await quotaExceeded()');
    const branch = handler.slice(start, handler.indexOf('} else {', start));
    expect(branch).toContain('OPERATIONAL_FALLBACK');
    expect(branch).toContain('incrementFallback');
    // Nada de montar contexto/prompt dentro do ramo que existe para não gastar.
    expect(branch).not.toContain('buildContext');
    expect(branch).not.toContain('buildSystemPrompt');
  });
});
