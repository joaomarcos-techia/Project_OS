import { describe, expect, it } from 'vitest';

import { scrubEvent } from './sentry-scrub';

describe('scrubEvent', () => {
  it('redige token no caminho de convite e dados estruturados de checkout', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://app.example.test/join/secret-invite-token?token=also-secret',
        data: {
          _1_cardNumber: 'card-number-private',
          _1_cardCvv: '123',
          _1_cpfCnpj: '12345678901',
          _1_password: 'senha-nao-deve-vazar',
          event: 'checkout.failed',
        },
      },
    });

    expect(event!.request?.url).toBe('https://app.example.test/join/[REDACTED]?token=[REDACTED]');
    expect(event!.request?.data).toBe('[REDACTED_REQUEST_BODY]');
  });

  it('redige TokenHash da URL de confirmação de e-mail', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://app.example.test/auth/confirm?token_hash=signup-secret&type=signup&next=%2Fcadastro%2Fcontinuar',
      },
    });

    expect(event!.request?.url).toBe(
      'https://app.example.test/auth/confirm?token_hash=[REDACTED]&type=signup&next=%2Fcadastro%2Fcontinuar',
    );
  });

  it('remove por inteiro um body multipart bruto', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        data: 'cardNumber=card-number-private&cardCvv=123',
      },
    });

    expect(event!.request?.data).toBe('[REDACTED_REQUEST_BODY]');
  });

  it('remove CPF, nome, convenio, body, cookie e authorization de um evento clinico', () => {
    const secrets = {
      cpf: '123.456.789-00',
      nome: 'Paciente Sintetico Privado',
      convenio: 'Convenio Sintetico Privado',
      body: 'texto clinico sob chave desconhecida',
      cookie: 'session=sessao-sintetica-privada',
      authorization: 'Bearer autorizacao-sintetica-privada',
    };
    const event = scrubEvent({
      type: undefined,
      request: {
        cookies: { session: secrets.cookie },
        headers: { Cookie: secrets.cookie, Authorization: secrets.authorization },
        data: { campoNovo: secrets.body },
      },
      extra: { paciente: [secrets], operation: 'clinical.read.failed' },
      contexts: { clinical: { ...secrets } },
    });

    // `scrubEvent` agora pode DESCARTAR (null) — só negativa de auth esperada.
    // Um evento clínico como este nunca é descartado.
    expect(event, 'evento legítimo foi descartado').not.toBeNull();
    for (const value of Object.values(secrets)) {
      expect(JSON.stringify(event)).not.toContain(value);
    }
    expect(event!.request).not.toHaveProperty('cookies');
    expect(event!.request).not.toHaveProperty('headers');
    expect(event!.request?.data).toBe('[REDACTED_REQUEST_BODY]');
    expect(event!.extra?.operation).toBe('clinical.read.failed');
  });
});

describe('negativa de auth esperada não vira incidente', () => {
  /** Formato que o Sentry produz para uma exceção lançada no servidor. */
  function evento(type: string, value: string) {
    return { type: undefined, exception: { values: [{ type, value }] } };
  }

  it('DESCARTA sessão expirada — o sinal já existe como métrica', () => {
    // `AuthError` emite `authz.denied` no construtor (SEC-050): baixa
    // cardinalidade, sem PII, e é o canal certo para contar sondagem de IDOR.
    // A exceção no Sentry era redundante — e redundância barulhenta enterra o
    // que importa. Visto em 14/09 repetindo em /consultorio, /agenda e
    // /configuracoes/lgpd, sempre após um refresh token recusado.
    expect(scrubEvent(evento('AuthError', 'Autenticação necessária'))).toBeNull();
  });

  it('DESCARTA sessão desatualizada por mudança de permissão', () => {
    expect(
      scrubEvent(evento('AuthError', 'Sua sessão está desatualizada. Entre novamente.')),
    ).toBeNull();
  });

  it('MANTÉM negativa de quem ESTÁ autenticado — ali a stack ajuda', () => {
    // 403 de usuário logado é outra história: ou é bug de autorização, ou é
    // alguém sondando com sessão válida. Nos dois casos "quem, onde, como
    // chegou aqui" tem resposta útil.
    expect(
      scrubEvent(evento('AuthError', 'Profile inexistente. Contate o administrador.')),
    ).not.toBeNull();
    expect(
      scrubEvent(evento('AuthError', 'Acesso desativado. Contate o administrador da clínica.')),
    ).not.toBeNull();
  });

  it('MANTÉM qualquer outro erro, mesmo com mensagem parecida', () => {
    // O filtro casa por TIPO e mensagem da tabela fechada. Um erro comum que
    // por acaso mencione autenticação continua subindo.
    expect(scrubEvent(evento('TypeError', 'Autenticação necessária'))).not.toBeNull();
    expect(scrubEvent(evento('Error', 'falha ao conectar'))).not.toBeNull();
  });

  it('evento sem exceção não é descartado', () => {
    expect(scrubEvent({ type: undefined })).not.toBeNull();
  });
});
