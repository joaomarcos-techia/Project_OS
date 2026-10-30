import { describe, expect, it } from 'vitest';

import { assertLocalScratchTarget, assertRestoreExit } from '../../../scripts/restore-test-result';

describe('restore:test — status do psql', () => {
  it('aceita apenas execução completa', () => {
    expect(() => assertRestoreExit(0)).not.toThrow();
  });

  it('reprova SQL interrompido ou erro de execução, mesmo com tabelas já existentes', () => {
    expect(() => assertRestoreExit(1)).toThrow('psql terminou com status 1');
    expect(() => assertRestoreExit(null)).toThrow('status indeterminado');
    expect(() => assertRestoreExit(null, new Error('spawn failed'))).toThrow(
      'não foi possível iniciar o psql',
    );
  });
});

describe('restore:test — alvo da escrita', () => {
  it('aceita somente banco local dedicado ao restore', () => {
    expect(() =>
      assertLocalScratchTarget('postgresql://localhost:5432/qoro_restore_drill'),
    ).not.toThrow();
    expect(() =>
      assertLocalScratchTarget('postgres://127.0.0.1:55479/qoro_restore_probe'),
    ).not.toThrow();
  });

  it.each([
    'postgresql://db.opaque-ref.supabase.co:5432/postgres',
    'postgresql://localhost:5432/postgres',
    'postgresql://localhost:5432/scratch',
    'https://localhost/qoro_restore_drill',
  ])('rejeita alvo remoto, banco genérico ou protocolo incorreto: %s', (url) => {
    expect(() => assertLocalScratchTarget(url)).toThrow('[guard] restore:test exige');
  });

  it('rejeita URL inválida', () => {
    expect(() => assertLocalScratchTarget('not a url')).toThrow('RESTORE_TARGET_URL inválida');
  });
});
