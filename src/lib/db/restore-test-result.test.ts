import { describe, expect, it } from 'vitest';

import { assertRestoreExit } from '../../../scripts/restore-test-result';

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
