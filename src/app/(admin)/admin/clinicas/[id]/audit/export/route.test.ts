/**
 * B6 (auditoria de APIs) — teto do export de auditoria.
 *
 * Duas propriedades:
 *   1. Span: a rota validava formato e ordem de `from`/`to`, mas nunca o TAMANHO.
 *   2. Truncagem: o repo corta em AUDIT_EXPORT_MAX_ROWS; o corte era silencioso e o
 *      sha256 ia para super_admin_actions como se atestasse o período inteiro.
 *
 * Status: 400 = malformado (sintaxe); 422 = bem-formado, não processável.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  guardAdminAccess,
  requireUser,
  assertPdfExportAllowed,
  run,
  superAdminAction,
  logError,
  logWarn,
  REQ_ID,
} = vi.hoisted(() => ({
  guardAdminAccess: vi.fn(async () => {}),
  requireUser: vi.fn(async () => ({ userId: 'sa-1' })),
  assertPdfExportAllowed: vi.fn(
    async (): Promise<{ ok: boolean; reason?: string }> => ({ ok: true }),
  ),
  run: vi.fn(),
  superAdminAction: vi.fn(async () => {}),
  logError: vi.fn(),
  logWarn: vi.fn(),
  REQ_ID: 'req-fixo-para-o-trace',
}));

vi.mock('../../../../_lib/guard', () => ({ guardAdminAccess }));
// `importOriginal` preserva AuditExportTooLargeError (o teste assere o mapeamento
// real do domain error → 422); só o `run` é stubado.
vi.mock('../../../../_lib/services/audit-export.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  auditExportService: { run },
}));
// O serviço é .tsx e arrasta o renderer WASM no import — stub, como no teste dele.
vi.mock('@react-pdf/renderer', () => ({
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: async () => Buffer.from(''),
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireUser }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertPdfExportAllowed }));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction }));
// `requestId` FIXO — com `() => ({})` o `rc.requestId` viria undefined e o
// `toErrorResponse` cairia no randomUUID de fallback, mascarando justamente a
// propriedade sob teste (o trace_id da resposta ser o do request/log).
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({
    ip: null,
    userAgent: null,
    requestId: REQ_ID,
    correlationId: REQ_ID,
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn: logWarn, error: logError, info: vi.fn(), debug: vi.fn() },
}));

import { AuditExportTooLargeError } from '../../../../_lib/services/audit-export.service';

import { POST } from './route';

const CLINIC = '11111111-1111-1111-8111-111111111111';

const post = (from: string, to: string, id = CLINIC): Promise<Response> =>
  POST(
    new Request(`https://qoro.app/admin/clinicas/${id}/audit/export?from=${from}&to=${to}`, {
      method: 'POST',
    }),
    {
      params: Promise.resolve({ id }),
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  guardAdminAccess.mockResolvedValue(undefined);
  requireUser.mockResolvedValue({ userId: 'sa-1' });
  assertPdfExportAllowed.mockResolvedValue({ ok: true });
  run.mockResolvedValue({
    signedUrl: 'https://x/y.pdf',
    sha256: 'abc',
    expiresInDays: 7,
    rowCount: 12,
  });
});

describe('400 — malformado (inalterado)', () => {
  it('data fora de YYYY-MM-DD → 400', async () => {
    expect((await post('01-01-2026', '2026-02-01')).status).toBe(400);
  });

  it('período invertido → 400', async () => {
    expect((await post('2026-06-01', '2026-01-01')).status).toBe(400);
  });

  it('clinic id não-UUID → 400', async () => {
    expect((await post('2026-01-01', '2026-02-01', 'nao-uuid')).status).toBe(400);
  });
});

describe('422 — span acima de 12 meses (B6)', () => {
  it('range de anos → 422 com a mensagem, sem gerar PDF', async () => {
    const res = await post('1970-01-01', '2999-12-31');
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe(
      'Período excede o limite máximo de exportação (12 meses).',
    );
    expect(run).not.toHaveBeenCalled(); // não paga o render
  });

  it('exatamente 12 meses → 422 (o limite é exclusivo)', async () => {
    expect((await post('2026-01-01', '2027-01-01')).status).toBe(422);
  });

  it('11 meses e 29 dias → passa', async () => {
    const res = await post('2026-01-01', '2026-12-30');
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('1 dia → passa', async () => {
    expect((await post('2026-06-01', '2026-06-01')).status).toBe(200);
  });
});

describe('422 — truncagem (achado novo)', () => {
  it('estouro do teto de linhas → 422 e NADA é gravado em super_admin_actions', async () => {
    run.mockRejectedValue(new AuditExportTooLargeError(5000));

    const res = await post('2026-01-01', '2026-03-01');

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('audit_export_too_large');
    expect(body.message).toContain('incompleto');
    expect(body).toHaveProperty('trace_id');
    // O ponto do achado: sem export completo, não existe atestação.
    expect(superAdminAction).not.toHaveBeenCalled();
  });
});

describe('B1 — erro inesperado não vaza internals', () => {
  it('500 com envelope genérico; a mensagem crua não vai para o corpo', async () => {
    run.mockRejectedValue(new Error('SECRET connection string postgres://user:pw@host'));

    const res = await post('2026-01-01', '2026-02-01');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: true, code: 'internal', message: 'Erro interno.' });
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });
});

describe('B6 — rate limit', () => {
  it('acima do teto → 429, sem gerar PDF', async () => {
    assertPdfExportAllowed.mockResolvedValue({ ok: false, reason: 'rate_limited' });

    const res = await post('2026-01-01', '2026-02-01');

    expect(res.status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  });

  // `scope: 'admin'` mantém o export de plataforma num balde separado — senão um
  // super_admin exportando em lote consumiria o orçamento de PDF da clínica-alvo e
  // barraria os usuários dela de gerar os próprios relatórios.
  it('teto é por super_admin e por clínica-alvo, em escopo admin', async () => {
    await post('2026-01-01', '2026-02-01');
    expect(assertPdfExportAllowed).toHaveBeenCalledWith(CLINIC, 'sa-1', 'admin');
  });
});

/**
 * Regressão que este bloco existe para travar: o envelope C16 tem `error` BOOLEANO
 * (`{error: true, code, message, …}`). O form lia `data.error` e punha `true` no
 * state; React não renderiza booleano → a caixa de erro aparecia VAZIA e a mensagem
 * do 422 nunca chegava ao operador. Todo erro desta rota usa UM shape só, e a
 * mensagem útil mora em `message`.
 */
describe('shape do erro — um só, e legível pelo cliente', () => {
  it.each([
    ['malformado (400)', '01-01-2026', '2026-02-01', 400],
    ['invertido (400)', '2026-06-01', '2026-01-01', 400],
    ['span excedido (422)', '1970-01-01', '2999-12-31', 422],
  ])('%s: envelope com `message` string não-vazia', async (_n, from, to, status) => {
    const res = await post(from, to);
    const body = await res.json();

    expect(res.status).toBe(status);
    expect(body.error).toBe(true); // envelope: booleano, NÃO a mensagem
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('trace_id');
  });

  it('429 também usa o envelope', async () => {
    assertPdfExportAllowed.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const body = await (await post('2026-01-01', '2026-02-01')).json();
    expect(body.error).toBe(true);
    expect(body.message).toContain('Muitos exports');
  });
});

/**
 * O contrato do envelope (error-response.ts) é que o `trace_id` **correlaciona a
 * resposta ao log**. Sem estes testes, apagar o `traceId` de todos os `fail()` deixa a
 * suíte verde: `toErrorResponse` gera um randomUUID de fallback e um
 * `toHaveProperty('trace_id')` passa igual — o operador recebe um id do usuário e não
 * acha nada no log. É a propriedade inteira do achado.
 */
describe('trace_id correlaciona resposta ↔ log', () => {
  it.each([
    ['400', '01-01-2026', '2026-02-01'],
    ['422', '1970-01-01', '2999-12-31'],
  ])('%s: trace_id do corpo é o requestId do request, não um id novo', async (_n, from, to) => {
    const body = await (await post(from, to)).json();
    expect(body.trace_id).toBe(REQ_ID);
  });

  it('429: idem', async () => {
    assertPdfExportAllowed.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const body = await (await post('2026-01-01', '2026-02-01')).json();
    expect(body.trace_id).toBe(REQ_ID);
  });

  it('500: o MESMO trace_id vai para o corpo E para o log — é o par que torna rastreável', async () => {
    run.mockRejectedValue(new Error('boom'));

    const body = await (await post('2026-01-01', '2026-02-01')).json();

    expect(body.trace_id).toBe(REQ_ID);
    expect(logError).toHaveBeenCalledWith(
      'admin.audit_export.error',
      expect.objectContaining({ trace_id: REQ_ID }),
    );
    // O log tem o detalhe; a resposta, não.
    const logged = logError.mock.calls[0]![1] as { message: string };
    expect(logged.message).toContain('boom');
    expect(JSON.stringify(body)).not.toContain('boom');
  });
});
