/**
 * DATA-006 — expediente com pausa é uma UNIDADE.
 *
 * O achado: `addExpediente()` aguardava duas chamadas sequenciais a
 * `setDoctorAvailability()`, cada uma com sua transação e sua chave idempotente.
 * A manhã respondia 200, a tarde conflitante 500, e o banco ficava com a manhã
 * gravada — o operador via o alerta de erro e concluía que nada tinha sido
 * salvo, enquanto a agenda já abria horários que o profissional não trabalha.
 * Um retry passava a conflitar também na manhã "fantasma".
 *
 * A validação do CONJUNTO é pura e testada aqui; a atomicidade da escrita é
 * afirmada sobre a fonte (uma transação, uma chave, uma auditoria).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SetAvailabilityWindowsSchema } from './types';

const actions = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/config-actions.ts'),
  'utf8',
);
const manager = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/configuracoes/horarios/horarios-manager.tsx'),
  'utf8',
);

const BASE = {
  doctorId: '11111111-1111-1111-8111-111111111111',
  weekday: 1,
};

describe('SetAvailabilityWindowsSchema — o conjunto é validado antes de escrever', () => {
  it('aceita manhã + tarde com pausa', () => {
    const parsed = SetAvailabilityWindowsSchema.safeParse({
      ...BASE,
      windows: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '14:00', endTime: '18:00' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('aceita janela única (expediente sem pausa)', () => {
    expect(
      SetAvailabilityWindowsSchema.safeParse({
        ...BASE,
        windows: [{ startTime: '09:00', endTime: '17:00' }],
      }).success,
    ).toBe(true);
  });

  it('rejeita janela invertida', () => {
    const parsed = SetAvailabilityWindowsSchema.safeParse({
      ...BASE,
      windows: [{ startTime: '18:00', endTime: '09:00' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejeita janela de duração zero', () => {
    expect(
      SetAvailabilityWindowsSchema.safeParse({
        ...BASE,
        windows: [{ startTime: '09:00', endTime: '09:00' }],
      }).success,
    ).toBe(false);
  });

  it('rejeita tarde que começa ANTES do fim da manhã', () => {
    // É o caso do achado: 08–09 e 14:30–15:30 contra uma janela 14–15 já
    // existente. Aqui a sobreposição interna morre antes de qualquer INSERT.
    const parsed = SetAvailabilityWindowsSchema.safeParse({
      ...BASE,
      windows: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '11:00', endTime: '18:00' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('detecta sobreposição mesmo com as janelas fora de ordem', () => {
    const parsed = SetAvailabilityWindowsSchema.safeParse({
      ...BASE,
      windows: [
        { startTime: '14:00', endTime: '18:00' },
        { startTime: '08:00', endTime: '15:00' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('janelas adjacentes (fim == início) são válidas — não há sobreposição', () => {
    expect(
      SetAvailabilityWindowsSchema.safeParse({
        ...BASE,
        windows: [
          { startTime: '08:00', endTime: '12:00' },
          { startTime: '12:00', endTime: '18:00' },
        ],
      }).success,
    ).toBe(true);
  });

  it('exige ao menos uma janela', () => {
    expect(SetAvailabilityWindowsSchema.safeParse({ ...BASE, windows: [] }).success).toBe(false);
  });
});

describe('setDoctorAvailabilityWindows — atomicidade', () => {
  const block = actions.slice(
    actions.indexOf('export async function setDoctorAvailabilityWindows'),
    actions.indexOf('export async function setDoctorAvailability('),
  );

  it('grava TODAS as janelas dentro de UMA idempotentMutation', () => {
    // Uma transação: se qualquer INSERT violar o EXCLUDE de sobreposição, o
    // conjunto inteiro reverte — zero estado parcial.
    expect(block.match(/idempotentMutation\(/gu)).toHaveLength(1);
    expect(block).toContain('for (const window of data.windows)');
  });

  it('usa UMA chave idempotente e UMA auditoria para o expediente', () => {
    expect(block.match(/idemKey\(/gu)).toHaveLength(1);
    expect(block).toContain("idemKey('avail_set_windows'");
    expect(block.match(/action: 'doctor_availability\.set_windows'/gu)).toHaveLength(1);
  });

  it('mantém o gate de permissão e o escopo de agenda alheia (AUTHZ-007)', () => {
    expect(block).toContain('PERMISSIONS.MANAGE_AVAILABILITY');
    expect(block).toContain('assertCanManageDoctorSchedule(user, data.doctorId)');
  });

  it('mantém a validação tenant do profissional e da unidade', () => {
    // A verificação é a MESMA da janela única (função extraída): duas cópias
    // divergiriam com o tempo.
    expect(block).toContain('assertPractitionerInClinic(tx, clinicId, data.doctorId)');
    expect(block).toContain('assertUnitInClinic(tx, clinicId, data.unitId)');
    expect(actions).toContain('async function assertPractitionerInClinic');
  });

  it('conflito continua virando erro de domínio controlado, não 500', () => {
    expect(block).toContain('asConflict(err)');
  });

  it('a UI chama a action ATÔMICA — não duas vezes a de janela única', () => {
    expect(manager).toContain('setDoctorAvailabilityWindows(');
    expect(manager).not.toContain('setDoctorAvailability(');
  });
});
