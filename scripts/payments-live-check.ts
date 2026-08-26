/**
 * Payments LIVE check (ADR-049/050) — chamadas REAIS ao sandbox do Asaas provando
 * o caminho de COBRANÇA DE PACIENTE de ponta a ponta, com uma chave que simula a
 * conta de uma clínica (modelo B).
 *
 * POR QUE existe: o `billing:live-check` prova o caminho da ASSINATURA na conta do
 * Qoro. O caminho do paciente usa métodos que aquele script nunca exercita —
 * `getMyAccount`, `createWebhook`, `createCustomer` **sem e-mail** (ADR-050 D2) e
 * `findPaymentByExternalReference`, que é a proteção contra cobrar duas vezes.
 * Todos foram escritos contra a documentação, não contra a API (achado **D17**).
 * Este script é o que fecha esse buraco.
 *
 * NÃO toca o banco. Cria objetos no SANDBOX e limpa o que dá para limpar.
 *
 * Requer `ASAAS_CLINIC_SANDBOX_KEY` no .env.local.
 * Uso: `pnpm payments:live-check`
 */
import { randomBytes } from 'node:crypto';

import './_env';

import { createAsaasClient, type AsaasClient, type CreateWebhookInput } from '@/lib/payments/asaas';

const BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://sandbox.asaas.com/api/v3';

const results: Array<{ step: string; ok: boolean; detail: string }> = [];

function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${step.padEnd(38)} ${detail}`);
}

/**
 * Chamada CRUA ao sandbox, para afordâncias que NÃO pertencem ao adapter.
 * `receiveInCash` existe só para simular pagamento em ambiente de teste; pôr isso
 * no código de produção seria abrir um caminho para marcar cobrança como paga sem
 * dinheiro nenhum ter entrado na conta da clínica.
 */
async function sandboxCall(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<{ status: number; codes: string }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', access_token: apiKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: Array<Record<string, unknown>> };
  const codes = (json.errors ?? []).map((e) => String(e.code ?? e.description ?? '?')).join(',');
  return { status: res.status, codes };
}

/**
 * Hoje em 'YYYY-MM-DD', no fuso do ASAAS (BRT) — nao em UTC.
 *
 * CAUSA-RAIZ do `invalid_object` que fazia `receiveInCash` falhar: o Asaas recusa
 * `paymentDate` no futuro, e depois das 21h de Brasilia o `toISOString()` ja
 * aponta para o dia seguinte. A mensagem do provedor era literal: *"A data
 * selecionada 25/08/2026 nao pode ser posterior a data atual."*
 */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function tomorrowISO(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/** Mensagem de erro sem corpo do provedor (o adapter já sanitiza; isto é 2ª rede). */
function why(err: unknown): string {
  if (err instanceof Error) {
    const codes = (err as { providerErrorCodes?: readonly string[] }).providerErrorCodes;
    if (codes?.length) return `${err.name}: ${codes.join(',')}`;
    // Mensagem NOSSA (as do provedor já foram descartadas pelo adapter): sem ela,
    // uma falha de passo aparece como "Error" e não diz nada a quem está lendo.
    return err.message ? `${err.name}: ${err.message}` : err.name;
  }
  return 'erro desconhecido';
}

/**
 * Passo que o ambiente NÃO permite verificar. Não entra na contagem: um check
 * vermelho permanente treina todo mundo a ignorar o vermelho, e um check verde
 * forjado é pior — passaria a impressão de que o caminho foi provado.
 */
const unverifiedSteps: string[] = [];

/**
 * Declara um caminho que este script NAO consegue provar contra o sandbox.
 *
 * Entra na contagem final de proposito: uma linha "n/v" que rola na tela e quase
 * o mesmo que nao existir. O que nao foi verificado precisa ser tao visivel
 * quanto o que passou — senao vira cobertura imaginaria.
 */
function unverified(step: string, detail: string): void {
  unverifiedSteps.push(step);
  console.log(` n/v  ${step.padEnd(38)} ${detail}`);
}

async function step(name: string, fn: () => Promise<string>): Promise<boolean> {
  try {
    record(name, true, await fn());
    return true;
  } catch (err) {
    record(name, false, why(err));
    return false;
  }
}

/** Remove uma cobranca criada so para a verificacao. Falha aqui e ruido. */
async function cleanupPayment(paymentId: string, apiKey: string): Promise<void> {
  const res = await sandboxCall('DELETE', `/payments/${paymentId}`, apiKey).catch(() => ({
    status: 0,
    codes: 'rede',
  }));
  if (res.status === 0 || res.status >= 400) {
    console.log(` aviso limpeza cobranca ${paymentId} falhou (HTTP ${res.status} ${res.codes})`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ASAAS_CLINIC_SANDBOX_KEY;
  if (!apiKey) {
    console.error('[payments-live] ASAAS_CLINIC_SANDBOX_KEY ausente no .env.local — abortando.');
    process.exit(1);
  }
  if (!apiKey.includes('hmlg')) {
    // Guarda dura: este script CRIA cobranças. Rodar contra produção geraria
    // cobrança real na conta de um cliente.
    console.error('[payments-live] a chave não parece de sandbox (sem "hmlg") — abortando.');
    process.exit(1);
  }

  const client: AsaasClient = createAsaasClient({ apiKey });
  const stamp = Date.now();
  let customerId = '';
  let paymentId = '';
  let webhookId = '';
  const externalReference = `livecheck:${stamp}`;

  let accountEmail: string | null = null;
  console.log('\n=== 1.1 — validação da credencial ===');
  await step('getMyAccount', async () => {
    const account = await client.getMyAccount({ attempts: 1 });
    accountEmail = account.email;
    return `conta="${account.name ?? '(sem nome)'}" email=${account.email ? 'sim' : 'NÃO VEIO'}`;
  });

  console.log('\n=== ADR-050 — customer com PII mínima (nome + CPF, SEM e-mail) ===');
  const customerOk = await step('createCustomer sem email', async () => {
    const created = await client.createCustomer({
      name: `Live Check Paciente ${stamp}`,
      cpfCnpj: '24971563792', // CPF de teste do sandbox
    });
    customerId = created.customerId;
    return `customerId=${customerId}`;
  });

  console.log('\n=== 1.3 — cobrança do sinal (link PIX/cartão) ===');
  if (customerOk) {
    await step('generateInvoice UNDEFINED', async () => {
      const payment = await client.generateInvoice({
        customerId,
        // R$ 5,00 é o MÍNIMO do Asaas para "Pergunte ao Cliente" (verificado ao
        // vivo em 2026-08-24). Abaixo disso a API recusa com `invalid_value`.
        value: 10,
        dueDate: tomorrowISO(),
        description: 'Sinal do agendamento',
        billingType: 'UNDEFINED',
        externalReference,
      });
      paymentId = payment.paymentId;
      return `paymentId=${paymentId} link=${payment.invoiceUrl ? 'sim' : 'NÃO VEIO'}`;
    });

    // A proteção contra cobrança dupla: o handler SEMPRE procura antes de criar.
    await step('findPaymentByExternalReference', async () => {
      const found = await client.findPaymentByExternalReference(externalReference, { attempts: 2 });
      if (!found) throw new Error('não encontrou a cobrança recém-criada');
      if (found.paymentId !== paymentId) throw new Error('encontrou OUTRA cobrança');
      return 'recupera a mesma cobrança';
    });

    await step('getPayment', async () => {
      const payment = await client.getPayment(paymentId, { attempts: 1 });
      return `status=${payment.status}`;
    });
  }

  console.log('\n=== 1.5 — cancelar cobranca NAO paga (ramo A/C sem pagamento) ===');
  if (customerOk) {
    // Cobranca separada: a do fluxo principal fica viva para o passo do getPayment.
    let voidableId = '';
    const voidableOk = await step('cobranca descartavel', async () => {
      const payment = await client.generateInvoice({
        customerId,
        value: 7,
        dueDate: tomorrowISO(),
        description: 'Sinal do agendamento',
        billingType: 'UNDEFINED',
        externalReference: `livecheck-void:${stamp}`,
      });
      voidableId = payment.paymentId;
      return `paymentId=${voidableId}`;
    });

    if (voidableOk) {
      await step('cancelPayment', async () => {
        const res = await client.cancelPayment(voidableId);
        if (!res.deleted) throw new Error('o Asaas nao confirmou a remocao');
        return 'cobranca removida';
      });

      // Idempotência REAL: é o caminho que a reentrega do worker percorre.
      // REGRA DESCOBERTA AQUI: o Asaas **não** devolve 404 para cobrança apagada.
      // Ele responde 200 com `deleted: true` e o `status` congelado no que era
      // antes. Um handler que confiasse no status trataria a cobrança morta como
      // viva e tentaria apagá-la de novo a cada reentrega.
      await step('getPayment de cobrança removida', async () => {
        const payment = await client.getPayment(voidableId, { attempts: 1 });
        if (!payment.deleted) {
          throw new Error(`ainda viva depois do DELETE (status=${payment.status})`);
        }
        return `deleted=true status=${payment.status} (o closeout usa \`deleted\`, não o status)`;
      });
    }
  }

  console.log('\n=== 1.5 — estorno de cobranca NAO paga (o Asaas recusa?) ===');
  if (paymentId) {
    await step('refundPayment em cobranca pendente', async () => {
      try {
        await client.refundPayment(paymentId);
      } catch (err) {
        const codes = (err as { providerErrorCodes?: readonly string[] }).providerErrorCodes;
        // O comportamento ESPERADO e a recusa: sem dinheiro recebido nao ha o que
        // devolver. E exatamente por isso que `charge-closeout` consulta o status
        // com `getPayment` ANTES de estornar, em vez de tentar e ver no que da.
        return `recusado como esperado (${codes?.join(',') ?? 'sem codigo'})`;
      }
      throw new Error('o Asaas ACEITOU estornar cobranca nao paga - revisar a guarda');
    });
  }

  console.log('\n=== 1.5 ramo C - o que o Asaas ACEITA estornar ===');
  if (customerOk) {
    const refundPayment = await client.generateInvoice({
      customerId,
      value: 10,
      dueDate: todayISO(),
      description: 'Sinal do agendamento',
      billingType: 'BOLETO',
      externalReference: `livecheck-refund:${stamp}`,
    });
    // `receiveInCash` simula a clinica marcando "recebi em dinheiro" no painel —
    // caminho que existe de verdade e que a clinica usa quando o paciente paga na
    // recepcao. A data vai no fuso do Asaas: futura, ele recusa.
    const received = await sandboxCall(
      'POST',
      `/payments/${refundPayment.paymentId}/receiveInCash`,
      apiKey,
      { paymentDate: todayISO(), value: 10 },
    );

    if (received.status >= 400) {
      unverified(
        'estorno exige PIX ou cartao',
        `sandbox recusou simular recebimento (HTTP ${received.status} ${received.codes})`,
      );
      await cleanupPayment(refundPayment.paymentId, apiKey);
    } else {
      await step('estorno exige PIX ou cartao', async () => {
        const paid = await client.getPayment(refundPayment.paymentId, { attempts: 2 });
        try {
          await client.refundPayment(refundPayment.paymentId);
        } catch (err) {
          const codes = (err as { providerErrorCodes?: readonly string[] }).providerErrorCodes;
          // REGRA DESCOBERTA AQUI, e a razao de `REFUNDABLE_BILLING_TYPES` existir:
          // *"Somente e possivel estornar cobrancas cuja a forma de pagamento seja
          // cartao de credito ou Pix."* O dinheiro ENTROU e mesmo assim o estorno
          // automatico e impossivel. Sem a guarda o handler tomaria 400 e o worker
          // retentaria ate desistir, sem ninguem entender o motivo.
          return `status=${paid.status} billingType=${paid.billingType} recusa=${codes?.join(',') ?? '?'}`;
        }
        throw new Error(
          `o Asaas estornou billingType=${paid.billingType} - REFUNDABLE_BILLING_TYPES obsoleta`,
        );
      });
    }

    // O caminho FELIZ (PIX/cartao pago -> estornado) exige pagamento real na
    // pagina do Asaas; nao ha afordancia de simulacao na API. Fica DECLARADO como
    // nao verificado, em vez de fingir cobertura.
    unverified(
      'estorno de sinal pago por PIX/cartao',
      'exige pagamento real na pagina do Asaas - sem simulacao pela API',
    );
  }

  console.log('\n=== D17 — registro do webhook (nunca validado até agora) ===');
  let webhookInput: CreateWebhookInput | null = null;
  await step('createWebhook', async () => {
    webhookInput = {
      name: `Qoro live check ${stamp}`,
      url: `https://example.invalid/api/webhooks/asaas/patient/${crypto.randomUUID()}`,
      // E-mail da PRÓPRIA conta: é para onde o Asaas avisa se o webhook falhar.
      email: accountEmail ?? '',
      // Mesmo gerador do connect real: o Asaas exige ≥32 caracteres E proíbe mais
      // de 4 iguais consecutivos (as duas regras foram descobertas AQUI).
      authToken: randomBytes(32).toString('base64url'),
      events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED', 'PAYMENT_OVERDUE'],
    };
    const created = await client.createWebhook(webhookInput);
    if (!created.webhookId) throw new Error('sem id no retorno');
    webhookId = created.webhookId;
    return `webhookId=${created.webhookId}`;
  });

  const existingWebhookInput = webhookInput;
  if (webhookId && existingWebhookInput) {
    await step('reconfigura webhook existente', async () => {
      const configured = await client.createWebhook(existingWebhookInput);
      if (configured.webhookId !== webhookId) {
        throw new Error('criou outro webhook em vez de atualizar o existente');
      }
      return `webhookId=${configured.webhookId} atualizado sem duplicar`;
    });
  }

  // Limpeza NÃO entra na contagem de falhas: o sandbox tolera lixo, mas um passo
  // de faxina reprovando uma verificação que passou seria ruído puro.
  console.log('\n=== limpeza (best-effort) ===');
  const cleanup = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      console.log(`  ok   limpeza ${what}`);
    } catch (err) {
      console.log(` aviso limpeza ${what} falhou (${why(err)}) — remova pelo painel se sobrar`);
    }
  };
  if (webhookId) {
    await cleanup('webhook', async () => {
      // `fetch` NAO rejeita em 4xx/5xx. Sem conferir o status, a faxina imprimia
      // "ok" e deixava o webhook para tras — e ele fica visivel no painel da
      // conta de um cliente. Limpeza que mente e pior que limpeza que falha.
      const res = await sandboxCall('DELETE', `/webhooks/${webhookId}`, apiKey);
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status}${res.codes ? ` (${res.codes})` : ''}`);
      }
    });
  }
  if (customerId) await cleanup('customer', () => client.deleteCustomer(customerId));

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[payments-live] ${results.length - failed.length}/${results.length} passos ok` +
      (unverifiedSteps.length ? ` - ${unverifiedSteps.length} NAO verificado(s)` : '') +
      (failed.length ? ` - FALHAS: ${failed.map((f) => f.step).join(', ')}` : ''),
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('[payments-live] erro não tratado:', why(err));
  process.exit(1);
});
