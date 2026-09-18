import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/env', () => ({ env: { MAGIC_TOKEN_SECRET: 'segredo-de-teste' } }));

import { hashToken } from './token';
import {
  SIGNUP_SESSION_CEILING,
  createSignupSession,
  purgeExpiredSignupSessions,
  readSignupSession,
  resetSignupCeilingCache,
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

describe('janitor', () => {
  it('APAGA as vencidas e reporta quantas seguem vivas', async () => {
    deleteMock.mockReturnValue(chain([{ id: 'a' }, { id: 'b' }]));
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
  });

  it('NÃO apaga vencida que guarda assinatura, e denuncia a retenção', async () => {
    // O ponto: a linha vencida com `asaas_subscription_id` é o único vínculo do
    // Qoro com uma cobrança recorrente que continua existindo no Asaas. Apagar
    // aqui trocaria uma linha órfã barata por uma assinatura órfã que cobra
    // alguém todo mês — por isso o janitor a preserva e grita.
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
