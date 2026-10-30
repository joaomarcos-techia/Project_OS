/**
 * OBS-002 — erro esperado do usuário não pode virar HTTP 500.
 *
 * O achado tinha duas metades. A de Procedimentos/Horários foi fechada no ciclo
 * anterior com `toActionResult`; a da Lista de espera continuava aberta:
 * `preferredFrom > preferredUntil` respondia 500 pela Server Action, com zero
 * persistência. O banco estava íntegro nas duas — Zod e os índices únicos
 * funcionaram como barreira de DADOS. O defeito é de CONTRATO: entrada
 * adulterada e conflito de negócio esperado não são falha interna, não devem
 * acionar alerta 5xx e precisam devolver texto acionável.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CreateWaitlistEntrySchema } from './types';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const actions = read('src/contexts/scheduling/actions.ts');
const uiActions = read('src/app/(app)/(shell)/agenda/lista-espera/actions.ts');
const manager = read('src/app/(app)/(shell)/agenda/lista-espera/waitlist-manager.tsx');
const boundary = read('src/contexts/scheduling/internal/action-result.ts');

const BASE = {
  patientId: '11111111-1111-1111-8111-111111111111',
  procedureId: '22222222-2222-2222-8222-222222222222',
};

describe('validação de domínio da lista de espera', () => {
  it('intervalo INVERTIDO é rejeitado pelo schema — este é o caso do achado', () => {
    const parsed = CreateWaitlistEntrySchema.safeParse({
      ...BASE,
      preferredFrom: '2026-09-20T00:00:00.000Z',
      preferredUntil: '2026-09-10T23:59:00.000Z',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.message).toMatch(/posterior/u);
  });

  it('intervalo de um único dia é válido (início == fim não é inversão)', () => {
    expect(
      CreateWaitlistEntrySchema.safeParse({
        ...BASE,
        preferredFrom: '2026-09-10T00:00:00.000Z',
        preferredUntil: '2026-09-10T23:59:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('intervalo ausente continua sendo aceito (preferência é opcional)', () => {
    expect(CreateWaitlistEntrySchema.safeParse(BASE).success).toBe(true);
  });

  it('data não-datetime é rejeitada', () => {
    expect(
      CreateWaitlistEntrySchema.safeParse({ ...BASE, preferredFrom: '10/09/2026' }).success,
    ).toBe(false);
  });

  it('payload incompleto é rejeitado', () => {
    expect(CreateWaitlistEntrySchema.safeParse({ patientId: BASE.patientId }).success).toBe(false);
  });
});

describe('OBS-002 — a negativa volta como resultado controlado', () => {
  it('as quatro actions da lista de espera passam pelo boundary', () => {
    for (const fn of [
      'createWaitlistEntry',
      'cancelWaitlistEntry',
      'acceptWaitlistOffer',
      'declineWaitlistOffer',
    ]) {
      const start = actions.indexOf(`export async function ${fn}(`);
      expect(start, `${fn} deve existir`).toBeGreaterThan(-1);
      const head = actions.slice(start, start + 500);
      expect(head, `${fn} deve devolver SchedulingActionResult`).toContain(
        'SchedulingActionResult',
      );
      expect(head, `${fn} deve envolver o corpo em toActionResult`).toContain('toActionResult(');
    }
  });

  it('a conversão de data local devolve resultado, não lança', () => {
    // Antes, `localBoundary` lançava um Error CRU aqui, FORA do boundary da
    // action: a exceção atravessava a fronteira RSC e virava 500 com alert
    // vazio.
    expect(uiActions).toContain('string | null');
    expect(uiActions).toContain("message: 'Informe uma data de preferência válida.'");
    expect(uiActions).not.toContain('throw new Error');
  });

  it('a UI consome o resultado discriminado', () => {
    expect(manager).toContain('unwrapAction(');
    // Nenhuma chamada direta sem unwrap — senão o `{ok:false}` viraria sucesso.
    for (const fn of [
      'createWaitlistFromUi',
      'cancelWaitlistEntry',
      'acceptWaitlistOffer',
      'declineWaitlistOffer',
    ]) {
      const index = manager.indexOf(`${fn}(`);
      expect(index).toBeGreaterThan(-1);
      const before = manager.slice(Math.max(0, index - 60), index);
      expect(before, `${fn} deve estar dentro de unwrapAction`).toContain('unwrapAction(');
    }
  });
});

describe('OBS-002 — o que NÃO é traduzido continua subindo', () => {
  it('só as classes conhecidas viram resultado; o resto vira 5xx + Sentry', () => {
    // Um catch genérico trocaria ruído por cegueira: timeout de banco e bug de
    // código PRECISAM chegar ao Sentry.
    expect(boundary).toContain('throw err; // inesperado — 5xx + Sentry, como deve ser');
    expect(boundary).toContain('err instanceof ZodError');
    expect(boundary).toContain('err instanceof AuthError');
    expect(boundary).toContain('err instanceof SchedulingValidationError');
    expect(boundary).toContain('err instanceof SchedulingConflictError');
  });

  it('sessão inválida e permissão negada têm mensagem própria, não 500', () => {
    expect(boundary).toContain("err.reason === 'PERMISSION_DENIED'");
    expect(boundary).toContain('Sua sessão expirou');
  });

  it('a mensagem do Zod não expõe path nem stack', () => {
    expect(boundary).toContain('err.issues[0]?.message');
    expect(boundary).not.toContain('err.issues[0]?.path');
  });
});
