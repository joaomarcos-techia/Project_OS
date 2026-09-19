/**
 * SEC-050 — toda negativa de autorização vira evento observável.
 *
 * O achado não era "falta um log": era que a classe de sondagem mais barata
 * (iterar ids de outro tenant, tentar escalar papel, chutar escopo) produzia
 * apenas uma sequência de 403 que ninguém contava. Detecção cega é o que
 * transforma um ataque de horas num ataque de meses.
 *
 * O emissor mora no construtor de `AuthError` porque é o ponto pelo qual TODA
 * negativa passa — não há decorator para alguém esquecer numa rota nova. Estes
 * testes travam essa propriedade e o formato do evento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metrics } from '@/lib/observability/metrics';

import { AuthError } from './tenant-context';

describe('authz.denied', () => {
  let emit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emit = vi.spyOn(metrics, 'emit').mockImplementation(() => undefined);
  });
  afterEach(() => emit.mockRestore());

  it('emite em negativa de permissão, com motivo estruturado', () => {
    new AuthError('sem permissão', 'forbidden', 403, 'PERMISSION_DENIED');

    expect(emit).toHaveBeenCalledWith('authz.denied', {
      code: 'forbidden',
      reason: 'PERMISSION_DENIED',
      httpStatus: 403,
    });
  });

  it('emite também em sessão inválida — sondagem sem cookie conta', () => {
    new AuthError('token inválido', 'unauthenticated', 401, 'TOKEN_INVALID');

    expect(emit).toHaveBeenCalledWith('authz.denied', {
      code: 'unauthenticated',
      reason: 'TOKEN_INVALID',
      httpStatus: 401,
    });
  });

  it('NÃO emite para erro de configuração: 500 de env não é sinal de ataque', () => {
    // Misturar os dois envenena o painel: um deploy com env faltando geraria
    // um pico de "negativas" que esconde a sondagem real.
    new AuthError('env ausente', 'config', 500, 'TOKEN_INVALID');

    expect(emit).not.toHaveBeenCalled();
  });

  it('o evento não carrega mensagem livre nem identificador de pessoa', () => {
    new AuthError('paciente 123 de joao@exemplo.com negado', 'forbidden', 403, 'ROLE_DENIED');

    const fields = emit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['code', 'httpStatus', 'reason']);
    expect(JSON.stringify(fields)).not.toContain('joao@exemplo.com');
    expect(JSON.stringify(fields)).not.toContain('123');
  });

  it('cada negativa conta uma vez — é isso que permite alertar por taxa', () => {
    for (let i = 0; i < 5; i += 1) {
      new AuthError('negado', 'forbidden', 403, 'PERMISSION_DENIED');
    }
    expect(emit).toHaveBeenCalledTimes(5);
  });
});

describe('gate: o emissor fica no ponto de estrangulamento', () => {
  it('AuthError continua emitindo do construtor', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/auth/tenant-context.ts'),
      'utf8',
    );
    // Se alguém mover a emissão para os call sites, o próximo `throw new
    // AuthError` esquecido volta a ser invisível.
    const constructorBlock = source.slice(
      source.indexOf('export class AuthError'),
      source.indexOf('export interface CurrentUser'),
    );
    expect(constructorBlock).toContain("metrics.emit('authz.denied'");
  });
});
