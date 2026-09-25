import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { selectMock, insertMock, updateMock, deleteMock, limitMock, emitMock, verifyMock } =
  vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    limitMock: vi.fn(),
    emitMock: vi.fn(),
    verifyMock: vi.fn(),
  }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  dbAdmin: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  },
}));
vi.mock('@/lib/auth/rate-limit', () => ({ assertSignupSessionAllowed: limitMock }));
// O classificador de risco NÃO é mockado: é função pura e o que ele decide é
// parte do comportamento sob teste. O Turnstile é, porque fala com a rede.
vi.mock('./turnstile', () => ({ verifyTurnstileToken: verifyMock }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: emitMock } }));
vi.mock('@/lib/env', () => ({
  env: {
    MAGIC_TOKEN_SECRET: 'segredo-de-teste',
    LOGIN_HASH_PEPPER: 'pepper-de-teste',
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
  },
}));

import { hashToken } from './token';
import {
  SIGNUP_SESSION_CEILING,
  advanceSignupCredentialEpoch,
  finishSignupCredentialEpoch,
  createSignupSession,
  purgeExpiredSignupSessions,
  readReservedSignupAttemptEpoch,
  readSignupDeliveryAttemptState,
  readSignupReferenceLiveness,
  readSignupContinuationIdentity,
  readSignupSession,
  resetSignupCeilingCache,
  signupContinuationSchema,
} from './signup-session';

/**
 * Cadeia drizzle: cada elo devolve `this` e o final resolve em `rows`.
 *
 * O tipo é declarado antes por causa da auto-referência — sem ele, `tsc` não
 * consegue inferir um objeto cujos métodos devolvem o próprio objeto.
 */
type Chain = Promise<unknown> & Record<string, () => Chain>;

function chain<T>(rows: T[]): Chain {
  const c = Promise.resolve(rows) as unknown as Chain;
  const self = (): Chain => c;
  Object.assign(c, {
    from: self,
    where: self,
    values: self,
    set: self,
    returning: self,
    orderBy: self,
    for: self,
    limit: self,
  });
  return c;
}

const IP = '203.0.113.7';
const HOST = 'app.qoro.dev';

/** Entrada padrão: risco BAIXO (origem coerente, balde vazio, limiter são). */
function criar(over: Partial<Parameters<typeof createSignupSession>[0]> = {}) {
  return createSignupSession({
    ip: IP,
    origin: `https://${HOST}`,
    expectedHost: HOST,
    ...over,
  });
}

/** Texto de qualquer estrutura, inclusive o objeto `sql` do drizzle (circular). */
function textoDe(valor: unknown, vistos = new Set<unknown>()): string {
  if (typeof valor === 'string') return valor;
  if (valor === null || typeof valor !== 'object') return '';
  if (vistos.has(valor)) return '';
  vistos.add(valor);
  return Object.values(valor as Record<string, unknown>)
    .map((v) => textoDe(v, vistos))
    .join(' ');
}

function insertedRow() {
  // `idleExpiresAt` vem do RETURNING porque o prazo e calculado pelo banco.
  return chain([
    {
      status: 'initiated',
      riskLevel: 0,
      rowVersion: 1,
      idleExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSignupCeilingCache();
  limitMock.mockResolvedValue({ allowed: true, budgetUsed: 0, degraded: false });
  verifyMock.mockResolvedValue({ ok: true });
  selectMock.mockReturnValue(chain([{ live: 0 }]));
  insertMock.mockReturnValue(insertedRow());
});

describe('token da sessão de cadastro', () => {
  it('separa o domínio do convite mágico: mesmo segredo, hashes diferentes', async () => {
    const capturado: string[] = [];
    insertMock.mockImplementation(() => ({
      values: (v: { tokenHash: string }) => {
        capturado.push(v.tokenHash);
        return insertedRow();
      },
    }));

    const criada = await criar();
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    // O MESMO token cru, passado pelo hash do convite, tem de dar outro valor.
    // Sem a separação de domínio os dois usos do segredo seriam intercambiáveis:
    // um hash de sessão poderia ser apresentado onde se espera um de convite.
    expect(capturado[0]).not.toBe(hashToken(criada.rawToken));
  });

  it('devolve o token cru UMA vez e nunca dentro do estado sanitizado', async () => {
    const criada = await criar();
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    expect(criada.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u); // 32 bytes base64url
    expect(JSON.stringify(criada.state)).not.toContain(criada.rawToken);
  });

  it('não põe o token cru em nenhuma métrica', async () => {
    const criada = await criar();
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    const emitido = JSON.stringify(emitMock.mock.calls);
    expect(emitido).not.toContain(criada.rawToken);
  });
});

describe('criação de sessão', () => {
  it('pede os TTLs ao relógio do BANCO, com 900 s de idle e 3600 s absolutos', async () => {
    let capturado: Record<string, unknown> | null = null;
    insertMock.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        capturado = v;
        return insertedRow();
      },
    }));

    await criar();

    // Os prazos são expressão SQL (`now() + make_interval`), não `Date` do
    // processo: gravar com o relógio da instância e comparar com o do Postgres
    // faria sessão morrer cedo ou viver demais conforme a deriva entre eles.
    const texto = textoDe(capturado);
    expect(texto).toContain('make_interval');
    expect(texto).toContain('now()');
    // O VALOR real dos prazos é verificado contra o banco em
    // `pnpm smoke:signup-session` — aqui só a intenção, porque o banco é mock.
    expect(JSON.stringify(capturado)).toContain('900');
    expect(JSON.stringify(capturado)).toContain('3600');
  });

  it('recusa sem escrever quando o rate limit nega', async () => {
    limitMock.mockResolvedValue({ allowed: false, budgetUsed: 1, degraded: false });

    const criada = await criar();

    expect(criada).toEqual({ ok: false, reason: 'rate_limited' });
    // O ponto do teste: recusar ANTES do INSERT. Recusar depois já teria
    // pago a escrita que o limite existe para evitar.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('recusa sem escrever quando o teto de sessões vivas foi atingido', async () => {
    selectMock.mockReturnValue(chain([{ live: SIGNUP_SESSION_CEILING }]));

    const criada = await criar();

    expect(criada).toEqual({ ok: false, reason: 'at_capacity' });
    expect(insertMock).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith(
      'signup.session.at_capacity',
      expect.objectContaining({ ceiling: SIGNUP_SESSION_CEILING }),
    );
  });

  it('o teto continua valendo com o rate limit DEGRADADO — é a válvula que sustenta degradar', async () => {
    // Cenário do apagão de Redis: o limiter devolve ok (fallback em memória
    // deixou passar) e mesmo assim o teto tem de segurar. Se não segurasse, a
    // decisão de degradar em vez de fechar não teria contenção nenhuma.
    limitMock.mockResolvedValue({ allowed: true, budgetUsed: 0, degraded: false });
    selectMock.mockReturnValue(chain([{ live: SIGNUP_SESSION_CEILING + 10 }]));

    const criada = await criar();

    expect(criada).toEqual({ ok: false, reason: 'at_capacity' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('não conta o teto a cada requisição: a segunda chamada usa o cache', async () => {
    await criar();
    await criar();

    // Um COUNT por requisição seria custo fixo no caminho quente para uma
    // válvula que quase nunca dispara.
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe('desafio de bot (O-2b)', () => {
  it('risco BAIXO não pede desafio nem chama o Turnstile', async () => {
    const criada = await criar();

    expect(criada.ok).toBe(true);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('origem CROSS-SITE é recusada sem gastar desafio nem escrita', async () => {
    const criada = await criar({ origin: 'https://site-de-terceiro.example' });

    expect(criada).toEqual({ ok: false, reason: 'blocked' });
    // Não há caso legítimo de POST de cadastro vindo de outra origem, então não
    // se oferece desafio: recusa direto, antes do INSERT.
    expect(verifyMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('origem AUSENTE pede desafio em vez de recusar', async () => {
    const criada = await criar({ origin: null });

    expect(criada).toEqual({ ok: false, reason: 'challenge_required' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('com token válido, a requisição de risco moderado passa', async () => {
    verifyMock.mockResolvedValue({ ok: true });

    const criada = await criar({ origin: null, turnstileToken: 'token-bom' });

    expect(criada.ok).toBe(true);
    expect(verifyMock).toHaveBeenCalledWith('token-bom', IP);
  });

  it('token inválido NÃO cria sessão', async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: 'invalid' });

    const criada = await criar({ origin: null, turnstileToken: 'token-ruim' });

    expect(criada).toEqual({ ok: false, reason: 'challenge_required' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('Turnstile INALCANÇÁVEL falha fechado no caminho de desafio', async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: 'unreachable' });

    const criada = await criar({ origin: null, turnstileToken: 'token-qualquer' });

    // Não conseguir a prova não autoriza seguir como se ela tivesse sido dada.
    // Só afeta quem já estava sob suspeita: o caminho de risco baixo nem passa
    // por aqui, então um apagão da Cloudflare não derruba o cadastro normal.
    expect(criada).toEqual({ ok: false, reason: 'challenge_required' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('LIMITER DEGRADADO passa a exigir desafio — controle compensatório', async () => {
    limitMock.mockResolvedValue({ allowed: true, budgetUsed: 0, degraded: true });

    const criada = await criar();

    // Sem o balde distribuído a defesa por IP deixou de existir de fato. O
    // desafio entra no lugar dela enquanto durar o apagão, em vez de simplesmente
    // deixar passar.
    expect(criada).toEqual({ ok: false, reason: 'challenge_required' });
  });

  it('balde por IP acima da metade já pede prova, antes de o limite estourar', async () => {
    limitMock.mockResolvedValue({ allowed: true, budgetUsed: 0.6, degraded: false });

    const criada = await criar();

    expect(criada).toEqual({ ok: false, reason: 'challenge_required' });
  });

  it('grava no banco o nível de risco apurado, não um valor fixo', async () => {
    let capturado: Record<string, unknown> | null = null;
    insertMock.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        capturado = v;
        return insertedRow();
      },
    }));
    verifyMock.mockResolvedValue({ ok: true });

    await criar({ origin: null, turnstileToken: 'token-bom' });

    expect((capturado as Record<string, unknown> | null)?.riskLevel).toBe(1);
  });
});

describe('leitura de sessão', () => {
  it('devolve null para token desconhecido — resposta genérica, sem distinguir casos', async () => {
    updateMock.mockReturnValue(chain([]));
    selectMock.mockReturnValue(chain([]));

    expect(await readSignupSession('token-que-nao-existe')).toBeNull();
  });

  it('expõe ao navegador original somente que o e-mail foi confirmado em outro aparelho', async () => {
    const absoluteExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    updateMock.mockReturnValue(chain([]));
    selectMock.mockReturnValue(chain([{ riskLevel: 0, rowVersion: 6, absoluteExpiresAt }]));

    await expect(readSignupSession('confirmado-em-outro-aparelho')).resolves.toEqual({
      status: 'email_verified',
      riskLevel: 0,
      expiresAt: absoluteExpiresAt.toISOString(),
      rowVersion: 6,
      answers: null,
    });
  });

  it('oferece handoff à segunda sessão somente depois que um draft irmão foi confirmado', async () => {
    const idleExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    updateMock.mockReturnValue(
      chain([
        {
          status: 'email_pending',
          riskLevel: 0,
          rowVersion: 5,
          idleExpiresAt,
          professionalsBand: '2_5',
          weeklyAppointmentsBand: '21_50',
          currentTooling: 'outro_sistema',
          discoverySource: 'indicacao_colega',
          emailHash: 'email-hash',
          authAttemptState: 'completed',
        },
      ]),
    );
    selectMock.mockReturnValue(chain([{ id: 'verified-sibling' }]));

    await expect(readSignupSession('segunda-sessao')).resolves.toEqual({
      status: 'email_verified',
      riskLevel: 0,
      expiresAt: idleExpiresAt.toISOString(),
      rowVersion: 5,
      answers: null,
    });
  });

  it('renova o prazo de inatividade sem deixar passar do absoluto', async () => {
    const idle = new Date(Date.now() + 15 * 60 * 1000);
    let setArg: Record<string, unknown> | null = null;
    updateMock.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        setArg = v;
        return chain([
          {
            status: 'initiated',
            riskLevel: 0,
            rowVersion: 1,
            idleExpiresAt: idle,
            professionalsBand: null,
            weeklyAppointmentsBand: null,
            currentTooling: null,
            discoverySource: null,
          },
        ]);
      },
      where: () => chain([]),
    }));

    const estado = await readSignupSession('qualquer');

    expect(estado?.status).toBe('initiated');
    expect(estado?.answers).toBeNull();
    // `least(novo_idle, absolute)`: sem isso, atividade contínua a cada 15 min
    // tornaria a sessão eterna e o teto absoluto viraria decoração.
    expect(textoDe(setArg)).toContain('least');
  });

  it('devolve as quatro respostas fechadas para retomada após reload', async () => {
    const answers = {
      professionalsBand: '2_5',
      weeklyAppointmentsBand: '21_50',
      currentTooling: 'outro_sistema',
      discoverySource: 'indicacao_colega',
    } as const;
    updateMock.mockReturnValue(
      chain([
        {
          status: 'details_complete',
          riskLevel: 0,
          rowVersion: 2,
          idleExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          ...answers,
        },
      ]),
    );

    await expect(readSignupSession('com-respostas')).resolves.toEqual(
      expect.objectContaining({ status: 'details_complete', rowVersion: 2, answers }),
    );
  });

  it('falha fechado se o banco devolver respostas parciais', async () => {
    updateMock.mockReturnValue(
      chain([
        {
          status: 'details_complete',
          riskLevel: 0,
          rowVersion: 2,
          idleExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          professionalsBand: '2_5',
          weeklyAppointmentsBand: '21_50',
          currentTooling: 'outro_sistema',
          discoverySource: null,
        },
      ]),
    );

    await expect(readSignupSession('parcial')).rejects.toThrow(
      'respostas persistidas violam o contrato',
    );
  });
});

describe('continuação Auth entre aparelhos', () => {
  const rawToken = 'a'.repeat(43);
  const continuation = {
    rowVersion: 7,
    email: 'ana@example.test',
    password: 'SenhaForte7',
    verificationCode: '12345678',
  };

  it('o schema é estrito e o browser não escolhe ids nem estado', () => {
    expect(signupContinuationSchema.safeParse(continuation).success).toBe(true);
    expect(signupContinuationSchema.safeParse({ ...continuation, userId: 'forged' }).success).toBe(
      false,
    );
    expect(
      signupContinuationSchema.safeParse({ ...continuation, clinicId: 'forged' }).success,
    ).toBe(false);
    expect(
      signupContinuationSchema.safeParse({ ...continuation, captchaToken: 'ignored' }).success,
    ).toBe(false);
  });

  it('devolve somente o user id gravado na linha que casa cookie, e-mail e versão', async () => {
    selectMock.mockReturnValue(
      chain([
        {
          userId: '11111111-1111-4111-8111-111111111111',
          authAttemptedAt: new Date('2026-09-23T12:00:00.000Z'),
          rowVersion: 7,
          authAttemptState: 'completed',
        },
      ]),
    );

    await expect(readSignupContinuationIdentity(rawToken, continuation)).resolves.toEqual({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      attemptEpoch: Date.parse('2026-09-23T12:00:00.000Z'),
      codeSignupRef: expect.any(String),
      credentialRowVersion: 7,
      credentialState: 'completed',
      adoption: null,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('distingue corrida de credencial morta sem revelar outra identidade', async () => {
    selectMock
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([{ id: 'draft' }]));
    await expect(readSignupContinuationIdentity(rawToken, continuation)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });

    selectMock
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]));
    await expect(readSignupContinuationIdentity(rawToken, continuation)).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it('lê do banco a referência confirmada que pode ser adotada pelo código', async () => {
    const sourceSignupRef = 'd'.repeat(64);
    selectMock
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([{ emailHash: 'same-email-hash' }]))
      .mockReturnValueOnce(
        chain([
          {
            userId: '11111111-1111-4111-8111-111111111111',
            tokenHash: sourceSignupRef,
            authAttemptedAt: new Date('2026-09-23T12:00:00.000Z'),
            rowVersion: 9,
            authAttemptState: 'uncertain',
          },
        ]),
      );

    await expect(readSignupContinuationIdentity(rawToken, continuation)).resolves.toEqual({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      attemptEpoch: Date.parse('2026-09-23T12:00:00.000Z'),
      codeSignupRef: sourceSignupRef,
      credentialRowVersion: 9,
      credentialState: 'uncertain',
      adoption: { targetRowVersion: 7 },
    });
  });

  it('recusa token e e-mail inválidos antes de consultar o banco', async () => {
    await expect(readSignupContinuationIdentity('curto', continuation)).resolves.toEqual({
      ok: false,
      reason: 'gone',
    });
    await expect(
      readSignupContinuationIdentity(rawToken, { ...continuation, email: 'invalido' }),
    ).resolves.toEqual({ ok: false, reason: 'gone' });
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe('epoch CAS de credencial pré-tenant', () => {
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    signupRef: 'd'.repeat(64),
    expectedRowVersion: 7,
    source: 'continuation' as const,
  };

  it('incrementa a versão antes do I/O externo e devolve o novo epoch', async () => {
    updateMock.mockReturnValue(chain([{ rowVersion: 8 }]));

    await expect(advanceSignupCredentialEpoch(input)).resolves.toEqual({
      ok: true,
      rowVersion: 8,
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it.each([
    [[{ id: 'draft' }], 'conflict'],
    [[], 'gone'],
  ] as const)('distingue epoch concorrente de draft morto: %s', async (rows, reason) => {
    updateMock.mockReturnValue(chain([]));
    selectMock.mockReturnValue(chain([...rows]));

    await expect(advanceSignupCredentialEpoch(input)).resolves.toEqual({ ok: false, reason });
  });

  it('recusa identidade, referência e versão inválidas antes do banco', async () => {
    await expect(advanceSignupCredentialEpoch({ ...input, signupRef: 'curta' })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    await expect(
      advanceSignupCredentialEpoch({ ...input, expectedRowVersion: 2_147_483_647 }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('fecha a reserva e permite reparar marker set sem nova Admin API', async () => {
    updateMock.mockReturnValue(chain([{ rowVersion: 9 }]));
    await expect(
      finishSignupCredentialEpoch({
        userId: input.userId,
        signupRef: input.signupRef,
        expectedRowVersion: 8,
        outcome: 'completed',
      }),
    ).resolves.toEqual({ ok: true, rowVersion: 9 });
  });

  it('é idempotente quando o estado já terminou na mesma versão', async () => {
    updateMock.mockReturnValue(chain([]));
    selectMock.mockReturnValue(chain([{ rowVersion: 9, authAttemptState: 'completed' }]));
    await expect(
      finishSignupCredentialEpoch({
        userId: input.userId,
        signupRef: input.signupRef,
        expectedRowVersion: 9,
        outcome: 'completed',
      }),
    ).resolves.toEqual({ ok: true, rowVersion: 9 });
  });
});

describe('epoch do codigo de handoff', () => {
  it('le somente a reserva exata gravada pelo relogio do banco', async () => {
    selectMock.mockReturnValue(chain([{ authAttemptedAt: new Date('2026-09-23T12:01:00.000Z') }]));
    await expect(readReservedSignupAttemptEpoch('a'.repeat(43), 6, 'resend')).resolves.toBe(
      Date.parse('2026-09-23T12:01:00.000Z'),
    );
  });

  it('falha fechado sem reserva ou com entrada invalida', async () => {
    selectMock.mockReturnValue(chain([]));
    await expect(readReservedSignupAttemptEpoch('a'.repeat(43), 6, 'initial')).resolves.toBeNull();
    await expect(readReservedSignupAttemptEpoch('curto', 6, 'initial')).resolves.toBeNull();
  });
});

describe('revalidacao pos-generateLink', () => {
  const input = {
    signupRef: 'd'.repeat(64),
    attemptEpoch: Date.parse('2026-09-23T12:01:00.000Z'),
    kind: 'resend' as const,
    userId: '11111111-1111-4111-8111-111111111111',
  };

  it.each([
    [{ status: 'email_pending', authUserId: null }, 'pending'],
    [{ status: 'email_verified', authUserId: input.userId }, 'verified'],
    [undefined, 'stale'],
  ] as const)('classifica a tentativa exata sem confiar no provider: %#', async (row, state) => {
    selectMock.mockReturnValue(chain(row ? [row] : []));
    await expect(readSignupDeliveryAttemptState(input)).resolves.toBe(state);
  });

  it('aceita somente pending+reserved ou verified+completed na corrida do reenvio', async () => {
    let where: unknown;
    selectMock.mockReturnValue({
      from: () => ({
        where: (condition: unknown) => {
          where = condition;
          return {
            limit: () => Promise.resolve([{ status: 'email_verified', authUserId: input.userId }]),
          };
        },
      }),
    });

    await expect(readSignupDeliveryAttemptState(input)).resolves.toBe('verified');
    const compiled = new PgDialect().sqlToQuery(where as SQL);
    expect(compiled.params).toEqual([
      input.signupRef,
      input.kind,
      new Date(input.attemptEpoch).toISOString(),
      'email_pending',
      'reserved',
      'email_verified',
      'completed',
      input.userId,
    ]);
  });
});

describe('estabilidade do link de outro draft pending', () => {
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'ana@example.test',
    signupRef: 'd'.repeat(64),
  };

  it.each([
    [[{ id: 'session-id' }], 'live'],
    [[], 'gone'],
  ] as const)('classifica a referencia sem expor dados: %#', async (rows, expected) => {
    selectMock.mockReturnValue(chain([...rows]));
    await expect(readSignupReferenceLiveness(input)).resolves.toBe(expected);
  });

  it('falha fechado quando o banco esta indisponivel', async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });
    await expect(readSignupReferenceLiveness(input)).resolves.toBe('unavailable');
  });
});

describe('janitor', () => {
  it('APAGA as vencidas e reporta quantas seguem vivas', async () => {
    let deleteWhere: unknown;
    deleteMock.mockReturnValue({
      where: (condition: unknown) => {
        deleteWhere = condition;
        return chain([{ id: 'a' }, { id: 'b' }]);
      },
    });
    // Dois SELECT, nesta ordem: retidas por assinatura e, depois, vivas.
    selectMock.mockReturnValueOnce(chain([{ n: 0 }])).mockReturnValueOnce(chain([{ live: 7 }]));

    const resultado = await purgeExpiredSignupSessions();

    expect(resultado).toEqual({ deleted: 2, live: 7, retainedWithSubscription: 0 });
    expect(emitMock).toHaveBeenCalledWith(
      'signup.session.expired',
      expect.objectContaining({ deleted: 2, live: 7 }),
    );
    expect(emitMock).not.toHaveBeenCalledWith(
      'signup.session.subscription_retained',
      expect.anything(),
    );
    const deleteSql = textoDe(deleteWhere);
    expect(deleteSql).toContain('now()');
    expect(deleteSql).toContain('billing_attempt_state');
    expect(deleteSql).toContain('billing_attempted_at');
    expect(deleteSql).toContain('asaas_customer_id');
    expect(deleteSql).toContain('asaas_subscription_id');
  });

  it('NÃO apaga vencida com qualquer tentativa de billing, e denuncia a retenção', async () => {
    // O ponto: qualquer marca de billing pode ser a única trilha de uma operação
    // que precisa de reconciliação. Apagar aqui pode perder a ligação com um
    // customer ou uma assinatura que segue existindo no Asaas.
    deleteMock.mockReturnValue(chain([{ id: 'a' }]));
    selectMock.mockReturnValueOnce(chain([{ n: 3 }])).mockReturnValueOnce(chain([{ live: 4 }]));

    const resultado = await purgeExpiredSignupSessions();

    expect(resultado).toEqual({ deleted: 1, live: 4, retainedWithSubscription: 3 });
    expect(emitMock).toHaveBeenCalledWith('signup.session.subscription_retained', { retained: 3 });
  });

  it('fica quieto quando não havia nada a apagar', async () => {
    deleteMock.mockReturnValue(chain([]));
    selectMock.mockReturnValueOnce(chain([{ n: 0 }])).mockReturnValueOnce(chain([{ live: 0 }]));

    const resultado = await purgeExpiredSignupSessions();

    expect(resultado.deleted).toBe(0);
    expect(emitMock).not.toHaveBeenCalledWith('signup.session.expired', expect.anything());
  });
});
