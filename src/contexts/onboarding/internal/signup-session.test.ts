import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectMock, insertMock, updateMock, deleteMock, limitMock, emitMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  limitMock: vi.fn(),
  emitMock: vi.fn(),
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
  Object.assign(c, { from: self, where: self, values: self, set: self, returning: self });
  return c;
}

const IP = '203.0.113.7';

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
  limitMock.mockResolvedValue({ ok: true });
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

    const criada = await createSignupSession(IP);
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    // O MESMO token cru, passado pelo hash do convite, tem de dar outro valor.
    // Sem a separação de domínio os dois usos do segredo seriam intercambiáveis:
    // um hash de sessão poderia ser apresentado onde se espera um de convite.
    expect(capturado[0]).not.toBe(hashToken(criada.rawToken));
  });

  it('devolve o token cru UMA vez e nunca dentro do estado sanitizado', async () => {
    const criada = await createSignupSession(IP);
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    expect(criada.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u); // 32 bytes base64url
    expect(JSON.stringify(criada.state)).not.toContain(criada.rawToken);
  });

  it('não põe o token cru em nenhuma métrica', async () => {
    const criada = await createSignupSession(IP);
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

    await createSignupSession(IP);

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
    limitMock.mockResolvedValue({ ok: false, reason: 'rate_limited' });

    const criada = await createSignupSession(IP);

    expect(criada).toEqual({ ok: false, reason: 'rate_limited' });
    // O ponto do teste: recusar ANTES do INSERT. Recusar depois já teria
    // pago a escrita que o limite existe para evitar.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('recusa sem escrever quando o teto de sessões vivas foi atingido', async () => {
    selectMock.mockReturnValue(chain([{ live: SIGNUP_SESSION_CEILING }]));

    const criada = await createSignupSession(IP);

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
    limitMock.mockResolvedValue({ ok: true });
    selectMock.mockReturnValue(chain([{ live: SIGNUP_SESSION_CEILING + 10 }]));

    const criada = await createSignupSession(IP);

    expect(criada).toEqual({ ok: false, reason: 'at_capacity' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('não conta o teto a cada requisição: a segunda chamada usa o cache', async () => {
    await createSignupSession(IP);
    await createSignupSession(IP);

    // Um COUNT por requisição seria custo fixo no caminho quente para uma
    // válvula que quase nunca dispara.
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe('leitura de sessão', () => {
  it('devolve null para token desconhecido — resposta genérica, sem distinguir casos', async () => {
    updateMock.mockReturnValue(chain([]));

    expect(await readSignupSession('token-que-nao-existe')).toBeNull();
  });

  it('renova o prazo de inatividade sem deixar passar do absoluto', async () => {
    const idle = new Date(Date.now() + 15 * 60 * 1000);
    let setArg: Record<string, unknown> | null = null;
    updateMock.mockImplementation(() => ({
      set: (v: Record<string, unknown>) => {
        setArg = v;
        return chain([{ status: 'initiated', riskLevel: 0, rowVersion: 1, idleExpiresAt: idle }]);
      },
      where: () => chain([]),
    }));

    const estado = await readSignupSession('qualquer');

    expect(estado?.status).toBe('initiated');
    // `least(novo_idle, absolute)`: sem isso, atividade contínua a cada 15 min
    // tornaria a sessão eterna e o teto absoluto viraria decoração.
    expect(textoDe(setArg)).toContain('least');
  });
});

describe('janitor', () => {
  it('APAGA as vencidas e reporta quantas seguem vivas', async () => {
    deleteMock.mockReturnValue(chain([{ id: 'a' }, { id: 'b' }]));
    selectMock.mockReturnValue(chain([{ live: 7 }]));

    const resultado = await purgeExpiredSignupSessions();

    expect(resultado).toEqual({ deleted: 2, live: 7 });
    expect(emitMock).toHaveBeenCalledWith(
      'signup.session.expired',
      expect.objectContaining({ deleted: 2, live: 7 }),
    );
  });

  it('fica quieto quando não havia nada a apagar', async () => {
    deleteMock.mockReturnValue(chain([]));
    selectMock.mockReturnValue(chain([{ live: 0 }]));

    const resultado = await purgeExpiredSignupSessions();

    expect(resultado.deleted).toBe(0);
    expect(emitMock).not.toHaveBeenCalledWith('signup.session.expired', expect.anything());
  });
});
