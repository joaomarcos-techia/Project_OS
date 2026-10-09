/**
 * Áudio e arquivo têm resposta (08/10/2026, W18) e a resposta do agente sai no
 * formato do WhatsApp (EC-24). O comportamento é coberto ao vivo no Preview;
 * aqui ficam as travas estruturais do handler que o produzem.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./inbound-received.ts', import.meta.url), 'utf8');
const messagingApi = readFileSync(new URL('../../../messaging/api.ts', import.meta.url), 'utf8');

describe('turno de mídia', () => {
  it('só mensagem sem texto vira mídia, e o resto sem texto continua sem resposta', () => {
    expect(source).toContain(
      'const media = payload.hasText ? null : inboundMedia(payload.messageType);',
    );
    expect(source).toContain(
      'if ((!media && (!payload.hasText || text.length === 0)) || inbound.fromNumber === null) {',
    );
  });

  it('mídia não absorve mensagens irmãs e grava o rótulo no lugar do conteúdo', () => {
    const faseA = source.slice(
      source.indexOf("// FASE A — conversa + mensagem 'in'"),
      source.indexOf('if (absorbed) {'),
    );
    expect(faseA).toMatch(
      /const siblings = media\s+\? \[\]\s+: await messagingApiV1\.claimPendingSiblings\(/,
    );
    expect(faseA).toMatch(/const joined = media\s+\? media\.turnText/);
  });

  it('o coalescing só reivindica texto (ou linha anterior à 0117)', () => {
    expect(messagingApi).toContain("AND (message_type IS NULL OR message_type = 'text')");
  });

  it('o ramo de mídia vem logo depois do replay, antes de urgência, cadastro e LLM', () => {
    const replay = source.indexOf('if (replayedOut) {\n    // Re-entrada pós-FASE D');
    const mediaBranch = source.indexOf('} else if (media) {');
    const emergency = source.indexOf("} else if (guard.kind === 'emergency') {");
    expect(replay).toBeGreaterThan(-1);
    expect(mediaBranch).toBeGreaterThan(replay);
    expect(mediaBranch).toBeLessThan(emergency);
    const branch = source.slice(mediaBranch, emergency);
    expect(branch).toContain('responseText = media.reply;');
    expect(branch).toMatch(
      /media\.kind === 'file'[\s\S]+escalateToHuman\(tx, clinicId, conversation\.id, 'media_received'\)/,
    );
    expect(branch).not.toContain('generate');
  });

  it('a resposta é convertida para o WhatsApp antes de ser gravada e enviada', () => {
    const format = source.indexOf(
      'if (!alreadyPersisted) responseText = toWhatsAppFormatting(responseText);',
    );
    expect(format).toBeGreaterThan(-1);
    expect(format).toBeLessThan(
      source.indexOf("// FASE D — persiste a resposta (checkpoint 'out' por eventId)."),
    );
    expect(format).toBeLessThan(source.indexOf('// FASE E — envia WhatsApp'));
  });
});
