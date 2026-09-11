/**
 * `withTenant` — o portão único de escopo de tenant.
 *
 * Desde a auditoria adversarial de 2026-09-11 (SEC-002) o teste cobre também o
 * fail-closed do role-switch. O pool `db` conecta com um papel **BYPASSRLS**:
 * quem isola é o `SET LOCAL ROLE authenticated`. Se esse switch silenciosamente
 * não surtir efeito, toda query da transação roda ignorando RLS e devolve dados
 * de todos os tenants — sem erro, sem log, com aparência de normalidade. É a
 * única forma de perder isolamento sem deixar sinal, e é o que estes testes
 * impedem de voltar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { execute, transaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));
const sqlTag = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', () => ({ sql: sqlTag }));
vi.mock('./index', () => ({ db: { transaction } }));

import { TenantRoleError, withTenant } from './tenant';

/**
 * O SELECT de escopo é a 2ª ida ao banco e devolve o papel efetivo. `role`
 * simula o que o Postgres responderia em `current_user`.
 */
function arrange(role: string | undefined) {
  execute.mockReset();
  execute.mockImplementation(() => Promise.resolve([{ role }]));
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ execute }),
  );
}

describe('withTenant', () => {
  beforeEach(() => {
    sqlTag.mockClear();
  });

  it('sets the request actor GUC only when an actor is supplied', async () => {
    arrange('authenticated');

    await expect(withTenant('clinic-1', async () => 'without-actor')).resolves.toBe(
      'without-actor',
    );
    // SET LOCAL ROLE + SELECT de escopo (que já carrega o current_user).
    expect(execute).toHaveBeenCalledTimes(2);

    execute.mockClear();
    await withTenant('clinic-1', async () => 'with-actor', 'user-1');

    expect(execute).toHaveBeenCalledTimes(3);
    const actorStatement = sqlTag.mock.calls.at(-1);
    expect(actorStatement?.[1]).toBe('user-1');
  });

  it('a leitura do papel não custa uma ida a mais ao banco', async () => {
    // O `current_user` viaja junto do `set_config` que já existia. Se alguém
    // separar em dois statements, os 162 call sites pagam latência por
    // transação — e o custo é o argumento que mataria a verificação.
    arrange('authenticated');
    await withTenant('clinic-1', async () => 'x');

    const scopeStatement = sqlTag.mock.calls.find((call) => String(call[0]).includes('set_config'));
    expect(scopeStatement, 'o SELECT de escopo sumiu').toBeDefined();
    expect(String(scopeStatement?.[0])).toContain('current_user');
    // Duas idas ao banco no caminho sem ator: o SET LOCAL e este SELECT.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('FAIL-CLOSED: papel BYPASSRLS aborta antes de executar o callback', async () => {
    arrange('postgres');
    const callback = vi.fn();

    await expect(withTenant('clinic-1', callback)).rejects.toBeInstanceOf(TenantRoleError);
    // O ponto inteiro: nenhuma query do caso de uso chegou a rodar.
    expect(callback).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: papel ausente é tratado como falha, não como permissão', async () => {
    arrange(undefined);
    const callback = vi.fn();

    await expect(withTenant('clinic-1', callback)).rejects.toBeInstanceOf(TenantRoleError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('o erro nomeia o papel observado, para o incidente não virar adivinhação', async () => {
    arrange('supabase_admin');
    await expect(withTenant('clinic-1', async () => 'x')).rejects.toMatchObject({
      name: 'TenantRoleError',
      actual: 'supabase_admin',
    });
  });
});
