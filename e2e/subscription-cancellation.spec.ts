import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { authenticate, hasE2ECredentials } from './auth';

/**
 * Cancelar, manter e reativar a assinatura PELA TELA — com a clínica de teste
 * real do DEV e a assinatura dela no sandbox do Asaas.
 *
 * ===================================================================
 * O que este spec prova que os testes de unidade não provam
 * ===================================================================
 * A jornada inteira, do clique ao estado do provedor: que cancelar em período de
 * teste é possível pela tela, que as cobranças JÁ GERADAS somem do Asaas (o
 * defeito de 28/09: `INACTIVE` as deixava vivas e o cartão era cobrado), que
 * "Manter assinatura" religa a recorrência, e que reativar reabre a clínica
 * (antes o `UPDATE clinics` do tenant casava zero linhas).
 *
 * ===================================================================
 * Por que só em localhost
 * ===================================================================
 * Ele escreve no banco de DEV e no sandbox do Asaas, e digita credencial de
 * teste. As três coisas só são aceitáveis contra o app rodando localmente,
 * ligado ao DEV. Os guardas abaixo recusam qualquer outra combinação.
 *
 * ===================================================================
 * Estado da clínica de teste
 * ===================================================================
 * O spec NUNCA toca a assinatura Asaas original da clínica. Ele cria uma
 * assinatura TEMPORÁRIA (boleto) para o mesmo cliente no sandbox — a criação já
 * gera a cobrança, o que garante o cenário do defeito —, aponta a clínica para
 * ela durante o teste e, no fim (inclusive em falha), remove a temporária e
 * devolve a linha da assinatura e o status da clínica exatamente como estavam.
 *
 * Isso veio de um defeito do próprio spec, pego na primeira execução: a
 * restauração antiga apagava TODA cobrança pendente da assinatura original,
 * inclusive as que já existiam antes do teste.
 *
 * Requisitos:
 *   E2E_BASE_URL=http://localhost:<porta>      app local ligado ao DEV
 *   E2E_SUBSCRIPTION_CANCEL=1                  opt-in (escreve em DEV/sandbox)
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD         dono de uma clínica EM TESTE
 *   E2E_DEV_DATABASE_URL                       banco de DEV (verificação e restauração)
 *   E2E_ASAAS_SANDBOX_URL / E2E_ASAAS_SANDBOX_KEY
 */

const baseUrl = process.env.E2E_BASE_URL ?? '';
const dbUrl = process.env.E2E_DEV_DATABASE_URL ?? '';
const asaasUrl = process.env.E2E_ASAAS_SANDBOX_URL ?? '';
const asaasKey = process.env.E2E_ASAAS_SANDBOX_KEY ?? '';
/** Ref do projeto Supabase de PRODUÇÃO — o banco que este spec nunca pode tocar. */
const PROD_PROJECT_REF = 'shlcbxawrxuaebazuiue';

function skipReason(): string | null {
  if (process.env.E2E_SUBSCRIPTION_CANCEL !== '1') return 'E2E_SUBSCRIPTION_CANCEL != 1';
  if (!hasE2ECredentials()) return 'credenciais E2E ausentes';
  if (!baseUrl || !['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) {
    return 'só roda contra o app em localhost';
  }
  if (!dbUrl || dbUrl.includes(PROD_PROJECT_REF)) return 'banco de DEV ausente ou é produção';
  if (!asaasUrl || new URL(asaasUrl).hostname !== 'sandbox.asaas.com' || !asaasKey) {
    return 'Asaas sandbox ausente';
  }
  return null;
}

type AsaasPayment = { id: string; status: string; dueDate: string; deleted?: boolean };

async function asaas(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`${asaasUrl}${path}`, {
    method,
    headers: {
      access_token: asaasKey,
      'Content-Type': 'application/json',
      'User-Agent': 'qoro-e2e',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as never };
}

async function unpaid(subscriptionId: string): Promise<AsaasPayment[]> {
  const out: AsaasPayment[] = [];
  for (const status of ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']) {
    const r = await asaas(
      'GET',
      `/subscriptions/${subscriptionId}/payments?status=${status}&limit=100`,
    );
    out.push(...((r.json?.data as AsaasPayment[]) ?? []).filter((p) => !p.deleted));
  }
  return out;
}

async function subscriptionAt(id: string): Promise<{ status: string; nextDueDate: string }> {
  const r = await asaas('GET', `/subscriptions/${id}`);
  return { status: String(r.json?.status), nextDueDate: String(r.json?.nextDueDate) };
}

/**
 * Espera o desfecho de uma ação da tela: a mensagem de sucesso OU um alerta de
 * erro. Esperar só o sucesso transformava qualquer recusa em "timeout", sem
 * dizer o que a tela mostrou.
 */
async function outcome(page: Page, sucesso: RegExp): Promise<void> {
  const ok = page.getByText(sucesso);
  const erro = page
    .locator('[role="alert"]')
    .filter({ hasText: /Não foi possível|Há um|já está/u });
  await expect(ok.or(erro).first()).toBeVisible({ timeout: 180_000 });
  if (await erro.count()) throw new Error(`a tela mostrou erro: ${await erro.first().innerText()}`);
}

const utcDate = (d: Date) => d.toISOString().slice(0, 10);
const brDate = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);

test.describe.configure({ mode: 'serial' });

test('cancelar em teste, manter, cancelar de novo e reativar — pela tela', async ({ page }) => {
  const skip = skipReason();
  test.skip(skip !== null, skip ?? '');
  test.setTimeout(10 * 60_000);

  const db = postgres(dbUrl, { max: 1, prepare: false });
  const [user] = await db<{ id: string }[]>`
    select id from auth.users where lower(email) = lower(${process.env.E2E_USER_EMAIL!})`;
  const [profile] = await db<{ clinic_id: string }[]>`
    select clinic_id::text as clinic_id from profiles where id = ${user!.id}`;
  const clinicId = profile!.clinic_id;
  const [snap] = await db<
    {
      id: string;
      billing_status: string;
      current_period_start: Date | null;
      current_period_end: Date | null;
      trial_ends_at: Date | null;
      cancel_at_period_end: boolean;
      dunning_stage: number;
      asaas_subscription_id: string;
    }[]
  >`select id::text as id, billing_status, current_period_start, current_period_end, trial_ends_at,
           cancel_at_period_end, dunning_stage, asaas_subscription_id
      from subscriptions where clinic_id = ${clinicId}::uuid`;
  const [clinicSnap] = await db<{ status: string }[]>`
    select status::text as status from clinics where id = ${clinicId}::uuid`;
  const trialEnd = snap!.trial_ends_at!;
  expect(snap!.billing_status, 'a conta de teste precisa estar em período de teste').toBe('trial');

  let asaasSubscriptionId = '';
  try {
    const [customer] = await db<{ asaas_customer_id: string }[]>`
    select asaas_customer_id from billing_customers where clinic_id = ${clinicId}::uuid`;
    const [price] = await db<{ amount: string }[]>`
    select pr.amount from subscriptions s join prices pr on pr.id = s.price_id
     where s.id = ${snap!.id}::uuid`;
    const created = await asaas('POST', '/subscriptions', {
      customer: customer!.asaas_customer_id,
      billingType: 'BOLETO',
      value: Number(price!.amount),
      cycle: 'MONTHLY',
      nextDueDate: utcDate(trialEnd),
      description: 'e2e: cancelamento pela tela (temporária)',
      externalReference: `e2e-cancel-${Date.now()}`,
    });
    expect(created.status, 'criar a assinatura temporária no sandbox').toBe(200);
    asaasSubscriptionId = String(created.json?.id);
    await db`update subscriptions set asaas_subscription_id = ${asaasSubscriptionId}
            where id = ${snap!.id}::uuid`;

    // Pré-condição que dá sentido ao teste: cobrança JÁ GERADA e viva no Asaas.
    let antes: AsaasPayment[] = [];
    for (let i = 0; i < 15 && antes.length === 0; i++) {
      antes = await unpaid(asaasSubscriptionId);
      if (antes.length === 0) await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(antes.length, 'o Asaas já precisa ter cobrança gerada').toBeGreaterThan(0);
    test.info().annotations.push({
      type: 'pré-condição',
      description: `${antes.length} cobrança(s) viva(s) no sandbox antes do cancelamento`,
    });

    await authenticate(page);

    // 1. Cancelar DURANTE O TESTE — antes a tela dizia que não havia o que cancelar.
    await page.goto('/configuracoes/assinatura');
    await expect(page.getByText(/não há assinatura ativa para cancelar/u)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('todas as cobranças em aberto no Asaas são apagadas');
    await expect(dialog).toContainText(`O acesso continua até ${brDate(trialEnd)}`);
    await dialog.getByRole('button', { name: 'Cancelar assinatura' }).click();
    await outcome(page, /as cobranças em aberto foram apagadas no Asaas/u);

    expect((await subscriptionAt(asaasSubscriptionId)).status).toBe('INACTIVE');
    expect(await unpaid(asaasSubscriptionId), 'nenhuma cobrança viva pode sobrar').toEqual([]);
    const [agendado] = await db<{ effective_at: Date }[]>`
      select effective_at from subscription_change_requests
       where clinic_id = ${clinicId}::uuid and kind = 'cancellation' and status = 'scheduled'`;
    expect(agendado?.effective_at.toISOString()).toBe(trialEnd.toISOString());
    const [abertas] = await db<{ n: number }[]>`
      select count(*)::int as n from invoices
       where clinic_id = ${clinicId}::uuid and status in ('open', 'overdue', 'partial')`;
    expect(abertas!.n, 'invoice local da cobrança apagada precisa estar cancelada').toBe(0);

    // 2. "Manter assinatura" religa a recorrência no Asaas antes de revogar.
    await page.reload();
    await page.getByRole('button', { name: 'Manter assinatura' }).click();
    await outcome(page, /Cancelamento revogado/u);
    expect(await subscriptionAt(asaasSubscriptionId)).toEqual({
      status: 'ACTIVE',
      nextDueDate: utcDate(trialEnd),
    });
    const [revogado] = await db<{ cancel_at_period_end: boolean }[]>`
      select cancel_at_period_end from subscriptions where id = ${snap!.id}::uuid`;
    expect(revogado!.cancel_at_period_end).toBe(false);

    // 3. Cancelar de novo — a mesma pessoa pode mudar de ideia outra vez.
    await page.reload();
    await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar assinatura' }).click();
    await outcome(page, /as cobranças em aberto foram apagadas no Asaas/u);
    expect((await subscriptionAt(asaasSubscriptionId)).status).toBe('INACTIVE');
    expect(await unpaid(asaasSubscriptionId)).toEqual([]);

    // 4. O dia da vigência chegou: o estado que o cron aplica (billing e clínica
    //    cancelados, pedido aplicado). Preparado por SQL — o alvo deste passo é
    //    a REATIVAÇÃO, e o cron tem teste próprio.
    await db.begin(async (tx) => {
      await tx`update subscription_change_requests set status = 'applied', applied_at = now()
                where clinic_id = ${clinicId}::uuid and kind = 'cancellation' and status = 'scheduled'`;
      await tx`update subscriptions set billing_status = 'cancelled', cancelled_at = now()
                where id = ${snap!.id}::uuid`;
      await tx`update clinics set status = 'cancelled'::clinic_status where id = ${clinicId}::uuid`;
      await tx`insert into subscription_history (clinic_id, subscription_id, old_status, new_status, reason)
               values (${clinicId}::uuid, ${snap!.id}::uuid, 'trial', 'cancelled', 'cancellation_period_end')`;
    });

    // 5. Reativar pela tela precisa REABRIR a clínica — antes ela ficava paga e bloqueada.
    await page.reload();
    await page.getByRole('button', { name: 'Reativar assinatura' }).click();
    await outcome(page, /Assinatura reativada/u);
    const [reaberta] = await db<{ status: string }[]>`
      select status::text as status from clinics where id = ${clinicId}::uuid`;
    expect(reaberta!.status, 'a clínica reativada tem de voltar a funcionar').toBe('active');
    const [billing] = await db<{ billing_status: string }[]>`
      select billing_status from subscriptions where id = ${snap!.id}::uuid`;
    expect(billing!.billing_status).toBe('active');
    expect((await subscriptionAt(asaasSubscriptionId)).status).toBe('ACTIVE');
  } finally {
    // A temporária sai inteira (o DELETE da assinatura remove as pendentes); a
    // original nunca foi tocada. O banco volta ao snapshot.
    if (asaasSubscriptionId) await asaas('DELETE', `/subscriptions/${asaasSubscriptionId}`);
    await db.begin(async (tx) => {
      await tx`update subscription_change_requests set status = 'cancelled', cancelled_at = now()
                where clinic_id = ${clinicId}::uuid and status in ('scheduled', 'pending_payment')`;
      await tx`update subscriptions
                  set billing_status = ${snap!.billing_status},
                      current_period_start = ${snap!.current_period_start},
                      current_period_end = ${snap!.current_period_end},
                      trial_ends_at = ${snap!.trial_ends_at},
                      cancel_at_period_end = ${snap!.cancel_at_period_end},
                      cancelled_at = null,
                      dunning_stage = ${snap!.dunning_stage},
                      asaas_subscription_id = ${snap!.asaas_subscription_id}
                where id = ${snap!.id}::uuid`;
      await tx`update clinics set status = ${clinicSnap!.status}::clinic_status
                where id = ${clinicId}::uuid`;
    });
    await db.end();
  }
});
