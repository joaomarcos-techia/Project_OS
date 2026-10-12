import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolvePhoneIdentity } from './conversation';

describe('identidade de paciente por telefone compartilhado', () => {
  it('associa somente quando existe exatamente um paciente', () => {
    const only = { id: 'p1', nome: 'Maria' };
    expect(resolvePhoneIdentity([only])).toEqual({ patient: only, ambiguous: false });
  });

  it('falha fechado quando mais de um paciente usa o telefone', () => {
    expect(
      resolvePhoneIdentity([
        { id: 'p1', nome: 'Maria' },
        { id: 'p2', nome: 'João' },
      ]),
    ).toEqual({ patient: null, ambiguous: true });
  });

  it('não inventa paciente quando não há correspondência', () => {
    expect(resolvePhoneIdentity([])).toEqual({ patient: null, ambiguous: false });
  });

  it('consulta até dois pacientes e nunca usa LIMIT 1 no match do telefone', () => {
    const source = readFileSync(new URL('./conversation.ts', import.meta.url), 'utf8');
    const lookup = source.slice(
      source.indexOf('const patientMatches'),
      source.indexOf('// Conversa não-encerrada'),
    );
    expect(lookup).toContain('.limit(2)');
    expect(lookup).not.toContain('.limit(1)');
  });

  it('casa o paciente em TODAS as grafias do número, não só no hash exato (08/10/2026)', () => {
    // O wa_id chega como 55 + DDD e, em linhas antigas, sem o nono dígito; a
    // clínica cadastra o número nacional. Com eq(telefoneHash, phoneHash) o
    // paciente cadastrado nunca era reconhecido e a IA pedia cadastro de novo.
    const source = readFileSync(new URL('./conversation.ts', import.meta.url), 'utf8');
    const lookup = source.slice(
      source.indexOf('const patientMatches'),
      source.indexOf('// Conversa não-encerrada'),
    );
    expect(lookup).toContain(
      'inArray(patients.telefoneHash, [...new Set([phoneHash, ...identityHashes])])',
    );
    expect(lookup).not.toContain('eq(patients.telefoneHash, phoneHash)');

    const handler = readFileSync(
      new URL('./handlers/inbound-received.ts', import.meta.url),
      'utf8',
    );
    expect(handler).toContain('const identityHashes = await phoneLookupHashes(fromNumber);');
  });

  it('supressão e óbito do envio comparam todas as grafias do destino', () => {
    const sender = readFileSync(
      new URL('../../messaging/internal/sender.ts', import.meta.url),
      'utf8',
    );
    expect(sender).toContain('inArray(patients.telefoneHash, toNumberHashes)');
    expect(sender).toContain('inArray(suppressionList.contactHash, toNumberHashes)');
  });

  it('traduz unique violation mesmo quando o Drizzle encapsula o SQLSTATE em cause', () => {
    const source = readFileSync(new URL('./conversation.ts', import.meta.url), 'utf8');
    const returnToAgent = source.slice(
      source.indexOf('export async function returnToAgent'),
      source.indexOf('export interface ManualMessageArgs'),
    );
    expect(returnToAgent).toContain('isUniqueViolation(err)');
    expect(returnToAgent).not.toContain(".code === '23505'");
  });
});
