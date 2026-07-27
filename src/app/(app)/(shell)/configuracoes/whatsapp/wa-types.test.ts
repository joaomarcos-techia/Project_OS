import { describe, expect, it } from 'vitest';

import { MetaConnectError } from '@/contexts/messaging/errors';

import { fail } from './wa-types';

describe('fail', () => {
  it('expõe orientação da etapa sem vazar detalhes internos da Meta', () => {
    const result = fail(
      new MetaConnectError('[meta] graph HTTP 400 code=100 com token secreto', {
        stage: 'phone_registration',
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: 'META_AUTH_FAILED',
      message:
        'A Meta recusou a ativação do número. Confirme a verificação por SMS/voz e use um PIN novo de 6 dígitos, diferente do código recebido.',
    });
    if (result.ok) throw new Error('expected Meta connection failure');
    expect(result.message).not.toContain('code=100');
    expect(result.message).not.toContain('secreto');
  });

  it('mantém mensagem genérica para uma etapa não identificada', () => {
    const result = fail(new MetaConnectError('[meta] falha desconhecida'));

    expect(result).toMatchObject({
      ok: false,
      code: 'META_AUTH_FAILED',
      message: 'Não foi possível conectar o WhatsApp. Tente novamente.',
    });
  });
});
