/**
 * O-5 — provas de contrato contra o Asaas SANDBOX real.
 *
 * Existe porque mock não vira aceite externo (§21.19). Tudo aqui usa o adapter
 * de produção (`asaasProvider`), não um segundo cliente: se o adapter mentir
 * sobre o contrato, este runner mente junto — e é isso que o torna prova.
 *
 * As quatro perguntas que a implementação local não podia responder sozinha:
 *   P1  o Asaas aceita assinar para um customer SEM CPF/CNPJ?
 *   P2  o readback devolve valor/ciclo/vencimento/estado como pedimos?
 *   P3  uma resposta PERDIDA (descarte injetado após um POST real) é recuperável por
 *       `externalReference`, sem reenviar o POST?
 *   P4  duas tentativas concorrentes com a mesma referência produzem UMA
 *       assinatura ou duas?
 *
 * NÃO toca o banco. A cardinalidade local (intenção única, CAS, estados) já é
 * provada pelo `signup-regression`; aqui o alvo é o lado de fora.
 *
 * Segurança: recusa rodar fora de host sandbox, exige confirmação explícita e
 * nunca imprime credencial. Ids saem redigidos.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { asaasProvider, BillingProviderError } from '@/lib/payments/asaas';
import { redactOpaqueId } from '@/lib/sanitize/redact';

const CONFIRM = 'ASAAS_SANDBOX_ONLY';
/**
 * CPF de teste do sandbox, o mesmo que `asaas-live-check.ts` já usa. Não é PII
 * real; existe porque o provedor EXIGE documento para assinar (P1).
 */
const SANDBOX_TEST_CPF = '24971563792';
const root = process.cwd();

type Result = {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail?: string;
  data?: Record<string, unknown>;
};
const results: Result[] = [];
/** Tudo que for criado entra aqui para a limpeza acontecer mesmo em falha. */
const createdSubscriptions = new Set<string>();
const createdCustomers = new Set<string>();
const attemptedReferences = new Set<string>();

function guard(): string {
  if (process.env.SANDBOX_CONFIRM !== CONFIRM) {
    throw new Error(`[sandbox] exige SANDBOX_CONFIRM=${CONFIRM}`);
  }
  const base = process.env.ASAAS_BASE_URL ?? '';
  const parsed = new URL(base);
  assert.ok(
    parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      ((parsed.hostname === 'sandbox.asaas.com' && parsed.pathname === '/api/v3') ||
        (parsed.hostname === 'api-sandbox.asaas.com' && parsed.pathname === '/v3')),
    '[sandbox] ASAAS_BASE_URL fora dos endpoints HTTPS oficiais de sandbox — abortado',
  );
  assert.ok(process.env.ASAAS_API_KEY, '[sandbox] ASAAS_API_KEY ausente');
  return base;
}

async function check(id: string, name: string, run: () => Promise<Record<string, unknown> | void>) {
  try {
    const data = await run();
    results.push({ id, name, status: 'PASS', ...(data ? { data } : {}) });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ id, name, status: 'FAIL', detail });
    console.log(`FAIL ${id} ${name}: ${detail}`);
  }
}

function dueDateAfterTrial(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Referência estável, com marca de runner para a limpeza reconhecer o que é nosso. */
function reference(tag: string): string {
  const value = `signup-sandbox:${tag}:${Date.now()}`;
  attemptedReferences.add(value);
  return value;
}

/**
 * Modo filho do P3.
 *
 * Falha de transporte INJETADA, com I/O real: native fetch envia o POST ao
 * sandbox; seu corpo de resposta é descartado antes de retornar ao adapter.
 * O pai mata este processo nessa fronteira, então reconcilia por GET. Não há
 * resposta sintética, mock de provedor, segundo POST ou medição de estado DB.
 */
async function lostPostChild(customerId: string, externalReference: string): Promise<never> {
  const base = guard();
  assert.ok(process.send, '[sandbox] modo filho exige canal IPC');
  const nativeFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, `${base}/subscriptions`, '[sandbox] I/O inesperado no filho');
    assert.equal(init?.method, 'POST', '[sandbox] o filho só pode criar uma assinatura');
    posts += 1;
    assert.equal(posts, 1, '[sandbox] POST repetido durante perda de resposta');
    const response = await nativeFetch(input, init);
    await response.body?.cancel();
    process.send?.({ type: 'response-discarded', posts, httpStatus: response.status });
    // Nunca entrega Response ao adapter. IPC mantém o filho vivo até o pai
    // encerrá-lo; o timeout do pai também cobre falhas anteriores a este ponto.
    return new Promise<Response>(() => {});
  };
  try {
    await asaasProvider.createSubscription({
      customerId,
      value: 149,
      cycle: 'MONTHLY',
      nextDueDate: dueDateAfterTrial(7),
      description: 'Qoro · plano essencial — resposta perdida',
      billingType: 'UNDEFINED',
      externalReference,
    });
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const subscriptionRow = z.object({
  id: z.string(),
  status: z.string().optional(),
  deleted: z.boolean().optional(),
  externalReference: z.string().nullable().optional(),
});
const customerRow = z.object({ id: z.string(), name: z.string().optional() });

async function sandboxGet(resource: string): Promise<Response> {
  const base = guard();
  return fetch(`${base}${resource}`, {
    headers: { access_token: process.env.ASAAS_API_KEY ?? '' },
    signal: AbortSignal.timeout(15_000),
  });
}

async function listSandbox<T>(resource: string, row: z.ZodType<T>): Promise<T[]> {
  const pageSchema = z.object({ data: z.array(row), hasMore: z.boolean() });
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const separator = resource.includes('?') ? '&' : '?';
    const response = await sandboxGet(`${resource}${separator}limit=100&offset=${offset}`);
    assert.ok(response.ok, `[sandbox] listagem falhou: HTTP ${response.status}`);
    const page = pageSchema.parse(await response.json());
    rows.push(...page.data);
    if (!page.hasMore) return rows;
    assert.ok(page.data.length > 0, '[sandbox] paginação vazia com hasMore=true');
  }
}

/**
 * Janitor das nossas fixtures no sandbox.
 *
 * Existe porque uma prova que falha no meio pode deixar assinatura viva, e
 * assinatura viva cobra. Varre as assinaturas da conta e cancela só as que
 * carregam referência deste runner ou do probe de contrato.
 */
async function cleanupOrphans(): Promise<never> {
  const base = guard();
  const key = process.env.ASAAS_API_KEY ?? '';
  const response = await fetch(`${base}/subscriptions?limit=100`, {
    headers: { access_token: key, 'Content-Type': 'application/json' },
  });
  assert.ok(response.ok, `[sandbox] listagem falhou: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { id: string; externalReference?: string }[] };
  const ours = (body.data ?? []).filter((row) =>
    /^(signup-sandbox|probe):/u.test(row.externalReference ?? ''),
  );
  console.log(`[sandbox] ${ours.length} assinatura(s) de teste encontradas`);
  let cancelled = 0;
  for (const row of ours) {
    try {
      await asaasProvider.cancelSubscription(row.id);
      cancelled += 1;
      console.log(`[sandbox] cancelada ${redactOpaqueId(row.id)}`);
    } catch (error) {
      console.log(
        `[sandbox] NAO cancelada ${redactOpaqueId(row.id)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(`[sandbox] ${cancelled}/${ours.length} canceladas`);

  // Customers também: um customer de teste sobrevivente não cobra ninguém, mas
  // suja a conta e mascara o próximo readback de "zero resíduo".
  const customersResponse = await fetch(`${base}/customers?limit=100`, {
    headers: { access_token: key, 'Content-Type': 'application/json' },
  });
  assert.ok(customersResponse.ok, `[sandbox] listagem de customers falhou`);
  const customersBody = (await customersResponse.json()) as {
    data?: { id: string; name?: string }[];
  };
  const testCustomers = (customersBody.data ?? []).filter((row) =>
    /^Qoro (Sandbox|Probe)/u.test(row.name ?? ''),
  );
  let removed = 0;
  for (const row of testCustomers) {
    try {
      await asaasProvider.deleteCustomer(row.id);
      removed += 1;
    } catch (error) {
      console.log(
        `[sandbox] NAO removido ${redactOpaqueId(row.id)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(`[sandbox] ${removed}/${testCustomers.length} customers de teste removidos`);

  // READBACK, e não o contador acima. Duas razões medidas em 18/09/2026:
  //   1. `DELETE /subscriptions/{id}` pode responder HTTP 500 e ainda assim ter
  //      apagado — contar a exceção como falha inventaria resíduo que não existe;
  //   2. o inverso também acontece: o contador fechou "3/3" e a varredura
  //      seguinte achou uma assinatura ACTIVE.
  // O que decide é o estado lido depois, não o código de retorno.
  const after = await fetch(`${base}/subscriptions?limit=100`, {
    headers: { access_token: key, 'Content-Type': 'application/json' },
  });
  assert.ok(after.ok, `[sandbox] readback falhou: HTTP ${after.status}`);
  const afterBody = (await after.json()) as {
    data?: { id: string; status?: string; deleted?: boolean; externalReference?: string }[];
  };
  const stillBilling = (afterBody.data ?? []).filter(
    (row) =>
      /^(signup-sandbox|probe|signup-webhook):/u.test(row.externalReference ?? '') &&
      row.status === 'ACTIVE' &&
      row.deleted !== true,
  );
  for (const row of stillBilling) {
    console.log(`[sandbox] RESIDUO ainda ACTIVE: ${redactOpaqueId(row.id)}`);
  }
  console.log(`[sandbox] readback: ${stillBilling.length} assinatura(s) ainda cobrando`);
  process.exit(stillBilling.length === 0 ? 0 : 1);
}

async function main(): Promise<void> {
  const base = guard();
  const startedAt = new Date().toISOString();
  console.log(`[sandbox] base=${base}`);

  /* ------------------------------------------------------------------ P1 */
  await check('P1', 'documento e obrigatorio para assinar (contrato)', async () => {
    // As duas pontas, na mesma execução: é o par que prova a causa. Sem ele,
    // "recusou" poderia ser `billingType`, host, valor ou qualquer outra coisa.
    const semDoc = await asaasProvider.createCustomer({
      name: 'Qoro Sandbox SemDoc',
      email: `signup-semdoc+${Date.now()}@qoro.dev`,
    });
    createdCustomers.add(semDoc.customerId);

    let refusedWithoutDocument: { codes: string[]; httpStatus: number | null } | null = null;
    try {
      const sub = await asaasProvider.createSubscription({
        customerId: semDoc.customerId,
        value: 149,
        cycle: 'MONTHLY',
        nextDueDate: dueDateAfterTrial(7),
        description: 'Qoro · sem documento',
        billingType: 'UNDEFINED',
        externalReference: reference('p1-semdoc'),
      });
      createdSubscriptions.add(sub.subscriptionId);
    } catch (error) {
      if (!(error instanceof BillingProviderError)) throw error;
      refusedWithoutDocument = {
        codes: [...error.providerErrorCodes],
        httpStatus: error.httpStatus,
      };
    }
    assert.ok(refusedWithoutDocument, 'sem documento DEVERIA ter sido recusado');

    const comDoc = await asaasProvider.createCustomer({
      name: 'Qoro Sandbox ComDoc',
      email: `signup-comdoc+${Date.now()}@qoro.dev`,
      cpfCnpj: SANDBOX_TEST_CPF,
    });
    createdCustomers.add(comDoc.customerId);
    const aceita = await asaasProvider.createSubscription({
      customerId: comDoc.customerId,
      value: 149,
      cycle: 'MONTHLY',
      nextDueDate: dueDateAfterTrial(7),
      description: 'Qoro · com documento',
      billingType: 'UNDEFINED',
      externalReference: reference('p1-comdoc'),
    });
    createdSubscriptions.add(aceita.subscriptionId);

    return {
      withoutDocument: { accepted: false, ...refusedWithoutDocument },
      withDocument: { accepted: true, subscription: redactOpaqueId(aceita.subscriptionId) },
      verdict: 'DOCUMENT_REQUIRED_BY_PROVIDER',
      // A variável isolada é o documento: `billingType` foi o mesmo nos dois.
      isolatedVariable: 'cpfCnpj',
    };
  });

  /* ------------------------------------------------------------------ P2 */
  await check('P2', 'readback de valor/ciclo/vencimento/estado', async () => {
    const customer = (
      await asaasProvider.createCustomer({
        name: 'Qoro Sandbox Readback',
        email: `signup-readback+${Date.now()}@qoro.dev`,
        cpfCnpj: SANDBOX_TEST_CPF,
      })
    ).customerId;
    createdCustomers.add(customer);

    const externalReference = reference('p2');
    const intent = {
      value: 149,
      cycle: 'MONTHLY' as const,
      nextDueDate: dueDateAfterTrial(7),
    };
    const created = await asaasProvider.createSubscription({
      customerId: customer,
      description: 'Qoro · plano essencial — readback',
      billingType: 'UNDEFINED',
      externalReference,
      ...intent,
    });
    createdSubscriptions.add(created.subscriptionId);

    const readback = await asaasProvider.getSubscription(created.subscriptionId);
    const found = await asaasProvider.findSubscriptionByExternalReference(externalReference);
    const rawResponse = await sandboxGet(
      `/subscriptions/${encodeURIComponent(created.subscriptionId)}`,
    );
    assert.ok(rawResponse.ok, `readback do contrato falhou: HTTP ${rawResponse.status}`);
    const schedule = z
      .object({ cycle: z.string(), nextDueDate: z.string() })
      .parse(await rawResponse.json());

    // A comparação é campo a campo e explícita: o servidor do Qoro é autoridade
    // de valor e ciclo (vêm do catálogo); o provedor é autoridade de estado.
    assert.equal(readback.value, intent.value, 'valor divergiu do catálogo');
    assert.equal(readback.status, 'ACTIVE', 'assinatura não nasceu ACTIVE');
    assert.equal(found?.externalReference, externalReference, 'externalReference não voltou');
    assert.equal(found?.subscriptionId, created.subscriptionId, 'referência apontou para outra');
    assert.equal(schedule.cycle, intent.cycle, 'ciclo divergiu do catálogo');
    // nextDueDate avança assim que o Asaas gera a primeira cobrança. O trial
    // contratado é medido no vencimento dessa cobrança, não no próximo ciclo.
    const payments = await asaasProvider.listSubscriptionPayments(created.subscriptionId);
    const firstPayment = payments
      .filter((payment) => !payment.deleted)
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
    assert.ok(firstPayment, 'primeira cobrança não encontrada no sandbox');
    assert.equal(firstPayment.dueDate, intent.nextDueDate, 'primeira cobrança divergiu do trial');
    assert.equal(
      firstPayment.value,
      intent.value,
      'valor da primeira cobrança divergiu do catálogo',
    );

    return {
      subscription: redactOpaqueId(created.subscriptionId),
      externalReference,
      qoroValue: intent.value,
      providerValue: readback.value,
      providerStatus: readback.status,
      qoroNextDueDate: intent.nextDueDate,
      providerNextDueDate: schedule.nextDueDate,
      firstPaymentDueDate: firstPayment.dueDate,
      providerCycle: schedule.cycle,
    };
  });

  /* ------------------------------------------------------------------ P3 */
  await check('P3', 'resposta perdida reconcilia sem repetir POST', async () => {
    const customer = (
      await asaasProvider.createCustomer({
        name: 'Qoro Sandbox Timeout',
        email: `signup-timeout+${Date.now()}@qoro.dev`,
        cpfCnpj: SANDBOX_TEST_CPF,
      })
    ).customerId;
    createdCustomers.add(customer);
    const externalReference = reference('p3');

    // Um único processo Node: matar o launcher do tsx deixava um neto vivo no
    // Windows. A fronteira de falha é sinalizada por IPC após I/O real.
    const child = spawn(
      process.execPath,
      [
        '--conditions=react-server',
        '--import',
        'tsx',
        path.join(root, 'scripts/security/signup-billing-sandbox.ts'),
        `--lost-post=${customer}|${externalReference}`,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env } },
    );
    const lost = await new Promise<{ posts: number; httpStatus: number }>((resolve, reject) => {
      let received: { posts: number; httpStatus: number } | null = null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 30_000);
      child.on('message', (message: unknown) => {
        const parsed = z
          .object({
            type: z.literal('response-discarded'),
            posts: z.literal(1),
            httpStatus: z.number().int(),
          })
          .safeParse(message);
        if (parsed.success) {
          received = parsed.data;
          child.kill('SIGKILL');
        }
      });
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('falha ao iniciar o processo da prova P3'));
      });
      child.once('close', () => {
        clearTimeout(timer);
        if (!received || timedOut) {
          reject(new Error('filho terminou sem provar descarte da resposta real'));
        } else {
          resolve(received);
        }
      });
    });
    assert.ok(lost.httpStatus >= 200 && lost.httpStatus < 300, 'POST não foi aceito pelo sandbox');

    // Somente GET depois da perda. Ausência momentânea jamais autoriza novo POST.
    let reconciled = await asaasProvider.findSubscriptionByExternalReference(externalReference);
    for (let attempt = 0; !reconciled && attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      reconciled = await asaasProvider.findSubscriptionByExternalReference(externalReference);
    }
    if (reconciled) createdSubscriptions.add(reconciled.subscriptionId);
    assert.ok(reconciled, 'assinatura não encontrada por externalReference após resposta perdida');
    assert.equal(reconciled.status, 'ACTIVE');
    const matches = await listSandbox(
      `/subscriptions?externalReference=${encodeURIComponent(externalReference)}`,
      subscriptionRow,
    );
    for (const row of matches) {
      assert.equal(row.externalReference, externalReference, 'provedor devolveu outra referência');
      createdSubscriptions.add(row.id);
    }
    assert.equal(
      matches.length,
      1,
      'a referência precisa corresponder a exatamente uma assinatura',
    );
    return {
      externalReference,
      lostResponse: true,
      injectedTransportLoss: true,
      targetPosts: lost.posts,
      subscription: redactOpaqueId(reconciled.subscriptionId),
      providerStatus: reconciled.status,
      verdict: 'RECOVERED_WITHOUT_SECOND_POST',
      scope:
        'adapter + sandbox reais; estado creation_unknown do banco provado em signup-regression',
    };
  });

  /* ------------------------------------------------------------------ P4 */
  await check(
    'P4',
    'provedor NAO tem idempotencia — quem impede a duplicata e o CAS local',
    async () => {
      const customer = (
        await asaasProvider.createCustomer({
          name: 'Qoro Sandbox Race',
          email: `signup-race+${Date.now()}@qoro.dev`,
          cpfCnpj: SANDBOX_TEST_CPF,
        })
      ).customerId;
      createdCustomers.add(customer);

      const externalReference = reference('p4');
      // Cada worker faz o que a orquestração faria SE chegasse ao provedor:
      // procura antes de criar. O ponto do teste é medir se isso basta.
      const attempt = async () => {
        const existing = await asaasProvider.findSubscriptionByExternalReference(externalReference);
        if (existing) return existing.subscriptionId;
        const created = await asaasProvider.createSubscription({
          customerId: customer,
          value: 149,
          cycle: 'MONTHLY',
          nextDueDate: dueDateAfterTrial(7),
          description: 'Qoro · plano essencial — corrida',
          billingType: 'UNDEFINED',
          externalReference,
        });
        return created.subscriptionId;
      };

      const [a, b] = await Promise.all([attempt(), attempt()]);
      createdSubscriptions.add(a);
      createdSubscriptions.add(b);
      const distinct = new Set([a, b]);
      const resolved = await asaasProvider.findSubscriptionByExternalReference(externalReference);

      // O resultado MEDIDO: o Asaas não aceita Idempotency-Key em POST e não
      // deduplica por `externalReference`. "Procurar antes de criar" estreita a
      // janela e NÃO a fecha — duas chamadas simultâneas produzem duas
      // assinaturas, e as duas cobrariam.
      //
      // Por isso a defesa real do O-5 não está aqui: está no
      // `reserveSignupBillingAttempt`, que serializa em `FOR UPDATE` e deixa
      // exatamente um chamador alcançar o provedor. A segunda aba recebe
      // `conflict` e nunca faz POST — provado em Postgres real pelo
      // `signup-regression`, bloco "billing O-5".
      //
      // A asserção protege a conclusão, não o defeito: se um dia o provedor
      // passar a deduplicar, este teste avisa em vez de seguir dizendo o mesmo.
      assert.ok(
        distinct.size >= 1 && distinct.size <= 2,
        `contagem inesperada de assinaturas: ${distinct.size}`,
      );

      return {
        externalReference,
        workerA: redactOpaqueId(a),
        workerB: redactOpaqueId(b),
        subscriptionsCreated: distinct.size,
        referenceResolvesTo: resolved ? redactOpaqueId(resolved.subscriptionId) : null,
        verdict:
          distinct.size === 1
            ? 'PROVIDER_DEDUPLICATED (mudou desde 18/09/2026 — revisar ADR-053)'
            : 'PROVIDER_HAS_NO_IDEMPOTENCY — defesa e o CAS local',
        defenseUnderTest: 'reserveSignupBillingAttempt (FOR UPDATE + CAS)',
      };
    },
  );

  /* -------------------------------------------------------------- cleanup */
  const cleanup: Record<string, unknown> = {};
  const cleanupErrors: { resource: string; httpStatus: number | null }[] = [];
  // Descobre também efeitos que aconteceram antes de uma asserção falhar ou
  // cuja resposta se perdeu. O contador local sozinho não prova ausência.
  await check('CLEANUP_DISCOVERY', 'localiza todas as referências desta execução', async () => {
    for (const externalReference of attemptedReferences) {
      const rows = await listSandbox(
        `/subscriptions?externalReference=${encodeURIComponent(externalReference)}`,
        subscriptionRow,
      );
      for (const row of rows) {
        assert.equal(row.externalReference, externalReference, 'cleanup recebeu referência alheia');
        createdSubscriptions.add(row.id);
      }
    }
  });
  let cancelled = 0;
  for (const id of createdSubscriptions) {
    try {
      await asaasProvider.cancelSubscription(id);
      cancelled += 1;
    } catch (error) {
      console.log(`[sandbox] DELETE inconclusivo ${redactOpaqueId(id)}; readback obrigatório`);
      cleanupErrors.push({
        resource: 'subscription',
        httpStatus: error instanceof BillingProviderError ? error.httpStatus : null,
      });
    }
  }
  let deleted = 0;
  for (const id of createdCustomers) {
    try {
      await asaasProvider.deleteCustomer(id);
      deleted += 1;
    } catch (error) {
      console.log(`[sandbox] DELETE inconclusivo ${redactOpaqueId(id)}; readback obrigatório`);
      cleanupErrors.push({
        resource: 'customer',
        httpStatus: error instanceof BillingProviderError ? error.httpStatus : null,
      });
    }
  }
  cleanup.subscriptionsCreated = createdSubscriptions.size;
  cleanup.subscriptionsCancelled = cancelled;
  cleanup.customersCreated = createdCustomers.size;
  cleanup.customersDeleted = deleted;
  cleanup.deleteResponsesInconclusive = cleanupErrors;
  await check(
    'CLEANUP_READBACK',
    'nenhuma assinatura ou customer da execução permanece',
    async () => {
      for (const id of createdSubscriptions) {
        const response = await sandboxGet(`/subscriptions/${encodeURIComponent(id)}`);
        if (response.status === 404) continue;
        assert.ok(response.ok, `readback de assinatura falhou: HTTP ${response.status}`);
        const row = subscriptionRow.parse(await response.json());
        assert.equal(row.deleted, true, 'assinatura de teste permanece no sandbox');
      }
      for (const id of createdCustomers) {
        const response = await sandboxGet(`/customers/${encodeURIComponent(id)}`);
        if (response.status === 404) continue;
        assert.ok(response.ok, `readback de customer falhou: HTTP ${response.status}`);
        const row = customerRow.extend({ deleted: z.boolean() }).parse(await response.json());
        assert.equal(row.deleted, true, 'customer de teste permanece no sandbox');
      }
      return { subscriptionsRemaining: 0, customersRemaining: 0 };
    },
  );
  console.log(
    `[sandbox] cleanup: ${cancelled}/${createdSubscriptions.size} assinaturas, ${deleted}/${createdCustomers.size} customers`,
  );

  const artifact = {
    environment: 'Asaas SANDBOX real, adapter de produção, sem banco',
    baseUrlHost: new URL(base).host,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    cleanup,
  };
  await mkdir(path.join(root, 'dist/track-o-sandbox'), { recursive: true });
  await writeFile(
    path.join(root, 'dist/track-o-sandbox/asaas-results.json'),
    JSON.stringify(artifact, null, 2),
  );

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`[sandbox] ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length === 0 ? 0 : 1);
}

const childArgs = process.argv.slice(2);
const lostFlag = childArgs.find((a) => a.startsWith('--lost-post='));
// EXCLUSIVO, e não sequencial. Antes, `--cleanup-orphans` disparava o janitor
// SEM `await` e a execução caía no `else` abaixo, que rodava a suíte inteira em
// paralelo: pedir limpeza CRIAVA assinatura nova, e o `process.exit()` do
// janitor matava a suíte no meio, deixando o que ela tinha acabado de criar.
// Observado em 18/09/2026 — a varredura seguinte achou uma `signup-sandbox:p2`
// ACTIVE logo depois de um "cleanup" que se declarou bem-sucedido.
if (childArgs.includes('--cleanup-orphans')) {
  void cleanupOrphans();
} else if (lostFlag) {
  const [customerId, externalReference] = lostFlag.slice('--lost-post='.length).split('|');
  assert.ok(customerId && externalReference, '[sandbox] argumentos do modo filho incompletos');
  void lostPostChild(customerId, externalReference);
} else {
  void main();
}
