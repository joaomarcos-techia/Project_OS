import { describe, expect, it } from 'vitest';

import { estimateTransferSeconds, planRecoveryCapacity } from './recovery-capacity';
import {
  openRecoveryPackage,
  RECOVERY_PACKAGE_LIMITS,
  sealRecoveryPackage,
} from './recovery-package';

const sizes = {
  databaseBytes: 600_000,
  storageEntryBytes: [100, 2_500_000],
  authUpperBoundBytes: 41_000,
  storageKeyUpperBoundBytes: 512,
};
const options = { freeBytes: 10_000_000_000, lockDays: 30, growthFactor: 1 };

describe('planejamento do backup independente', () => {
  it('conta gerações imutáveis, semanais, pré-rollout e margem sem atestar recuperação', () => {
    const plan = planRecoveryCapacity(sizes, options);
    expect(plan.retainedSets).toBe(36);
    expect(plan.reservedBytes).toBe(Math.ceil(plan.setUpperBoundBytes * 36 * 1.2));
    expect(plan.portableFormatFits).toBe(true);
    expect(plan.freeAllowanceFits).toBe(true);
    expect(plan.note).toContain('no upload, escrow or restore attestation');
  });

  it('lock maior aumenta a reserva; sem lock preserva as 12 cópias lógicas', () => {
    expect(planRecoveryCapacity(sizes, { ...options, lockDays: 0 }).retainedSets).toBe(12);
    expect(planRecoveryCapacity(sizes, { ...options, lockDays: 60 }).retainedSets).toBe(66);
  });

  it('estima um pacote acima do tamanho real e recupera bytes sintéticos', () => {
    const entries = [
      { id: 'storage-header.json', data: Buffer.alloc(31, 1) },
      { id: 'storage-key', data: Buffer.alloc(32, 2) },
      { id: 'auth-config', data: Buffer.alloc(128, 3) },
    ];
    const passphrase = 'synthetic-capacity-test-only-123456';
    const sealed = sealRecoveryPackage(entries, passphrase);
    const plan = planRecoveryCapacity(
      {
        databaseBytes: 1,
        storageEntryBytes: [31],
        authUpperBoundBytes: 128,
        storageKeyUpperBoundBytes: 32,
      },
      options,
    );
    expect(sealed.length).toBeLessThanOrEqual(plan.portableUpperBoundBytes);
    expect(openRecoveryPackage(sealed, passphrase)).toEqual(entries);
    expect(() => openRecoveryPackage(sealed, `${passphrase}-wrong`)).toThrow('authentication');
  });

  it('crescimento de dados não é aplicado a configurações/chave nem contado como previsão', () => {
    const plan = planRecoveryCapacity(sizes, { ...options, growthFactor: 10 });
    expect(plan.clearBytes).toBe(2_500_100 * 10 + 41_000 + 512);
    expect(plan.growthFactor).toBe(10);
  });

  it('detecta o limite do envelope mesmo quando ainda cabe na franquia', () => {
    const plan = planRecoveryCapacity(sizes, { ...options, growthFactor: 30 });
    expect(plan.clearBytes).toBeGreaterThan(RECOVERY_PACKAGE_LIMITS.clearBytes);
    expect(plan.portableFormatFits).toBe(false);
    expect(plan.freeAllowanceFits).toBe(true);
  });

  it('detecta franquia insuficiente independentemente do limite do pacote', () => {
    expect(planRecoveryCapacity(sizes, { ...options, freeBytes: 1 }).freeAllowanceFits).toBe(false);
  });

  it('inclui as duas entradas obrigatórias no limite de quantidade do formato', () => {
    const plan = planRecoveryCapacity(
      {
        ...sizes,
        storageEntryBytes: Array.from({ length: RECOVERY_PACKAGE_LIMITS.entries }, () => 1),
      },
      options,
    );
    expect(plan.portableFormatFits).toBe(false);
  });

  it.each([NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'recusa tamanho de banco inválido: %s',
    (databaseBytes) => {
      expect(() => planRecoveryCapacity({ ...sizes, databaseBytes }, options)).toThrow();
    },
  );

  it('recusa metadados vazios, fatores inválidos e overflow', () => {
    expect(() => planRecoveryCapacity({ ...sizes, storageEntryBytes: [] }, options)).toThrow();
    expect(() => planRecoveryCapacity(sizes, { ...options, lockDays: -1 })).toThrow();
    expect(() => planRecoveryCapacity(sizes, { ...options, growthFactor: 0 })).toThrow();
    expect(() =>
      planRecoveryCapacity({ ...sizes, databaseBytes: Number.MAX_SAFE_INTEGER }, options),
    ).toThrow();
  });

  it('calcula só tempo de transporte, com validação de banda', () => {
    expect(estimateTransferSeconds(4_000_000, 1)).toBe(32);
    expect(estimateTransferSeconds(4_000_000, 10)).toBe(4);
    expect(estimateTransferSeconds(0, 1)).toBe(0);
    expect(() => estimateTransferSeconds(1, 0)).toThrow();
    expect(() => estimateTransferSeconds(1, NaN)).toThrow();
    expect(() => estimateTransferSeconds(-1, 10)).toThrow();
  });
});
