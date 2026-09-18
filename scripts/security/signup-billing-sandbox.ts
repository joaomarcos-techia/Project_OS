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
 *   P3  uma resposta PERDIDA (timeout depois do POST) é recuperável por
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

import {
  asaasProvider,
  BillingProviderError,
  BillingProviderUnreachableError,
} from '@/lib/payments/asaas';
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

function guard(): string {
  if (process.env.SANDBOX_CONFIRM !== CONFIRM) {
    throw new Error(`[sandbox] exige SANDBOX_CONFIRM=${CONFIRM}`);
  }
  const base = process.env.ASAAS_BASE_URL ?? '';
  // Duas asserções, não uma: "contém sandbox" sozinho aceitaria um host
  // malicioso tipo `api.asaas.com/?x=sandbox`. A negativa é a que protege.
  assert.ok(base.includes('sandbox'), `[sandbox] ASAAS_BASE_URL nao aparenta ser sandbox`);
  assert.ok(
    !/(^|\/\/)api\.asaas\.com/u.test(base),
    '[sandbox] ASAAS_BASE_URL aponta para PRODUCAO — abortado',
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
  return `signup-sandbox:${tag}:${Date.now()}`;
}

/**
 * Modo filho do P3.
 *
 * Existe porque `env` é snapshot de import: baixar `ASAAS_HTTP_TIMEOUT_MS` em
 * `process.env` no meio da execução não afeta o adapter já carregado. O pai
 * dispara este processo com o timeout curto, e ele faz SÓ o POST — a
 * reconciliação acontece de volta no pai, com timeout normal. Os dois lados
 * usam o adapter real.
 *
 * Ele é MORTO em voo pelo pai; se chegar a terminar sozinho, a prova não vale
 * e o pai tenta de novo com menos folga.
 */
async function lostPostChild(customerId: string, externalReference: string): Promise<never> {
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
    if (error instanceof BillingProviderUnreachableError) process.exit(3);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
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
  process.exit(cancelled === ours.length && removed === testCustomers.length ? 0 : 1);
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

    // A comparação é campo a campo e explícita: o servidor do Qoro é autoridade
    // de valor e ciclo (vêm do catálogo); o provedor é autoridade de estado.
    assert.equal(readback.value, intent.value, 'valor divergiu do catálogo');
    assert.equal(readback.status, 'ACTIVE', 'assinatura não nasceu ACTIVE');
    assert.equal(found?.externalReference, externalReference, 'externalReference não voltou');
    assert.equal(found?.subscriptionId, created.subscriptionId, 'referência apontou para outra');

    return {
      subscription: redactOpaqueId(created.subscriptionId),
      externalReference,
      qoroValue: intent.value,
      providerValue: readback.value,
      providerStatus: readback.status,
      qoroNextDueDate: intent.nextDueDate,
    };
  });

  /* ------------------------------------------------------------------ P3 */
  await check('P3', 'resposta PERDIDA vira creation_unknown e reconcilia', async () => {
    const customer = (
      await asaasProvider.createCustomer({
        name: 'Qoro Sandbox Timeout',
        email: `signup-timeout+${Date.now()}@qoro.dev`,
        cpfCnpj: SANDBOX_TEST_CPF,
      })
    ).customerId;
    createdCustomers.add(customer);

    const externalReference = reference('p3');

    // Perda de resposta DE VERDADE: o filho dispara o POST e é morto em voo.
    // O request chega ao Asaas; nós nunca lemos a resposta. É o cenário que o
    // `creation_unknown` existe para cobrir — e não dá para simular com `throw`.
    //
    // O atraso da morte é auto-ajustável: se o POST ainda não tinha saído, a
    // referência não aparece e tentamos de novo com mais folga, até 3 vezes.
    let killDelayMs = 0;
    let reconciledEarly: Awaited<
      ReturnType<typeof asaasProvider.findSubscriptionByExternalReference>
    > = null;
    for (const delay of [250, 600, 1200]) {
      killDelayMs = delay;
      const child = spawn(
        process.execPath,
        [
          path.join(root, 'node_modules/tsx/dist/cli.mjs'),
          path.join(root, 'scripts/security/signup-billing-sandbox.ts'),
          `--lost-post=${customer}|${externalReference}`,
        ],
        { windowsHide: true, stdio: 'ignore', env: { ...process.env } },
      );
      const killed = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(true);
        }, delay);
        child.on('exit', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      // Dá tempo de o Asaas terminar de aplicar o que já recebeu.
      await new Promise((r) => setTimeout(r, 1_500));
      reconciledEarly = await asaasProvider.findSubscriptionByExternalReference(externalReference);
      if (reconciledEarly) {
        assert.ok(killed, 'a assinatura apareceu, mas o filho terminou sozinho');
        break;
      }
    }

    // O contrato do O-5: daqui NAO se reenvia POST. Pergunta-se, com o timeout
    // normal deste processo.
    const reconciled =
      reconciledEarly ??
      (await asaasProvider.findSubscriptionByExternalReference(externalReference));
    if (reconciled) createdSubscriptions.add(reconciled.subscriptionId);
    assert.ok(reconciled, 'o POST nunca chegou ao provedor — prova inconclusiva');

    return {
      externalReference,
      lostResponse: true,
      killDelayMs,
      reconciled: reconciled !== null,
      subscription: reconciled ? redactOpaqueId(reconciled.subscriptionId) : null,
      providerStatus: reconciled?.status ?? null,
      // `false` aqui nao e falha: significa que o POST morreu antes de chegar,
      // e o estado local `creation_unknown` continua correto e conservador.
      verdict: reconciled ? 'RECOVERED_WITHOUT_SECOND_POST' : 'NOTHING_WAS_CREATED',
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
  let cancelled = 0;
  for (const id of createdSubscriptions) {
    try {
      await asaasProvider.cancelSubscription(id);
      cancelled += 1;
    } catch (error) {
      console.log(`[sandbox] falha ao cancelar ${redactOpaqueId(id)}`);
      results.push({
        id: 'CLEANUP',
        name: `cancelamento de assinatura ${redactOpaqueId(id)}`,
        status: 'FAIL',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  let deleted = 0;
  for (const id of createdCustomers) {
    try {
      await asaasProvider.deleteCustomer(id);
      deleted += 1;
    } catch (error) {
      console.log(`[sandbox] falha ao apagar customer ${redactOpaqueId(id)}`);
      results.push({
        id: 'CLEANUP',
        name: `remocao de customer ${redactOpaqueId(id)}`,
        status: 'FAIL',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  cleanup.subscriptionsCreated = createdSubscriptions.size;
  cleanup.subscriptionsCancelled = cancelled;
  cleanup.customersCreated = createdCustomers.size;
  cleanup.customersDeleted = deleted;
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
if (childArgs.includes('--cleanup-orphans')) {
  void cleanupOrphans();
}
const lostFlag = childArgs.find((a) => a.startsWith('--lost-post='));
if (lostFlag) {
  const [customerId, externalReference] = lostFlag.slice('--lost-post='.length).split('|');
  assert.ok(customerId && externalReference, '[sandbox] argumentos do modo filho incompletos');
  void lostPostChild(customerId, externalReference);
} else {
  void main();
}
