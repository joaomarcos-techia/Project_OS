/**
 * Rajada de mensagens do mesmo contato = UMA resposta (F-08), também quando o
 * ingress processa cada mensagem na hora (08/10/2026). Ao vivo no Preview, três
 * mensagens simultâneas viraram três turnos concorrentes e três respostas: cada
 * um reivindicava as irmãs com SKIP LOCKED. O comportamento é coberto ao vivo;
 * aqui fica a trava estrutural que o produz.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./inbound-received.ts', import.meta.url), 'utf8');
const faseA = source.slice(
  source.indexOf("// FASE A — conversa + mensagem 'in'"),
  source.indexOf('if (absorbed) {'),
);

describe('FASE A serial por contato', () => {
  it('abre com lock de transação por clínica + contato, antes de qualquer leitura', () => {
    const lock = faseA.indexOf('pg_advisory_xact_lock(hashtextextended(');
    expect(lock).toBeGreaterThan(-1);
    expect(faseA).toContain('`ai-turn:${clinicId}:${inbound.fromNumberHash}`');
    expect(lock).toBeLessThan(faseA.indexOf('findOrCreateConversation('));
    expect(lock).toBeLessThan(faseA.indexOf('claimPendingSiblings('));
  });

  it('relê a própria mensagem sob o lock e sai se uma irmã já a absorveu', () => {
    const recheck = faseA.indexOf('getInboundForAgent(tx, clinicId, inbound.id)');
    expect(recheck).toBeGreaterThan(-1);
    // A releitura vem DEPOIS do checkpoint de replay e ANTES de reivindicar irmãs.
    expect(recheck).toBeGreaterThan(faseA.indexOf('if (turn.inRow)'));
    expect(recheck).toBeLessThan(faseA.indexOf('claimPendingSiblings('));
    expect(faseA).toMatch(/if \(fresh\?\.processedAt\) \{\s+return \{[^}]*absorbed: true/);
  });

  it('turno absorvido não persiste nem envia nada', () => {
    expect(source).toMatch(/if \(absorbed\) \{\s+metrics\.emit\([^;]+;\s+return;/);
  });
});
