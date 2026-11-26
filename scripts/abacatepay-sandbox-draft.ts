/** Synthetic Sandbox draft only. No DB/Auth/Meta/email, payment or production configuration. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { z } from 'zod';

import { createAbacatePayReadClient } from '../src/lib/payments/abacatepay/reader';
import { createAbacatePaySandboxCommands } from '../src/lib/payments/abacatepay/sandbox-commands';
import { CommandOperationError } from '../src/lib/payments/saas/command-operation';
import { GatewayReadError } from '../src/lib/payments/saas/contracts';
import { SandboxFileJournal } from './abacatepay-sandbox-journal';

const RUN_ID = 'qoro-v2-capability-20261107';
const PROBE_PRODUCT_ID = 'prod_yFBfdSA5twXU3hLREy1YkJtW';
const PRODUCT_OPERATION_ID = '0515f3ad-8822-4504-8db1-f80d83c6be15';
const CHECKOUT_OPERATION_ID = '7e0f1943-48a3-4889-a811-57258ce9ad6c';
const PRODUCT_REFERENCE = `${RUN_ID}-monthly-no-native-trial`;
const CHECKOUT_REFERENCE = `${RUN_ID}-checkout`;
const manifestSchema = z.object({
  runId: z.literal(RUN_ID),
  storeIdSha256: z.string().regex(/^[a-f0-9]{64}$/),
  probeProductId: z.literal(PROBE_PRODUCT_ID),
  productOperationId: z.literal(PRODUCT_OPERATION_ID),
  checkoutOperationId: z.literal(CHECKOUT_OPERATION_ID),
  amountMinor: z.literal(100),
  cycle: z.literal('MONTHLY'),
  nativeTrialDays: z.null(),
});
const trace: { method: string; path: string; status: number | null }[] = [];
const guardedFetch: typeof fetch = async (target, options) => {
  const url = new URL(String(target));
  if (
    url.origin !== 'https://api.abacatepay.com' ||
    !['GET', 'POST'].includes(options?.method ?? '')
  ) {
    throw new GatewayReadError('invalid_input');
  }
  const entry: (typeof trace)[number] = {
    method: options?.method ?? '',
    path: url.pathname,
    status: null,
  };
  trace.push(entry);
  const response = await fetch(target, options);
  entry.status = response.status;
  return response;
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'env-file': { type: 'string', default: 'C:/dev/ClinicaOS_V2/.env.local' },
      'apply-draft': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const apiKey = parse(await readFile(values['env-file'], 'utf8')).ABACATEPAY_API_KEY;
  if (!apiKey) throw new GatewayReadError('invalid_input');
  const reader = createAbacatePayReadClient({ apiKey, environment: 'sandbox' }, guardedFetch);
  const store = await reader.readStore();
  const probe = await reader.readProduct(PROBE_PRODUCT_ID);
  if (probe.price !== 100 || probe.cycle != null || probe.trialDays != null) {
    throw new GatewayReadError('binding_mismatch');
  }
  if (!values['apply-draft']) {
    console.log(
      JSON.stringify({ runId: RUN_ID, sandbox: 'PASS', stage: 'preflight_only', mutations: 0 }),
    );
    return;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) throw new GatewayReadError('invalid_input');
  const directory = path.join(localAppData, 'Qoro', 'SandboxBilling', RUN_ID);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = manifestSchema.parse({
    runId: RUN_ID,
    storeIdSha256: createHash('sha256').update(store.id).digest('hex'),
    probeProductId: PROBE_PRODUCT_ID,
    productOperationId: PRODUCT_OPERATION_ID,
    checkoutOperationId: CHECKOUT_OPERATION_ID,
    amountMinor: 100,
    cycle: 'MONTHLY',
    nativeTrialDays: null,
  });
  const manifestFile = path.join(directory, 'manifest.json');
  try {
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const existing = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')));
    if (JSON.stringify(existing) !== JSON.stringify(manifest))
      throw new GatewayReadError('binding_mismatch');
  }
  const journal = new SandboxFileJournal(path.join(directory, 'operations'));
  const commands = createAbacatePaySandboxCommands(
    { apiKey, storeId: store.id, probeProductId: PROBE_PRODUCT_ID },
    journal,
    guardedFetch,
  );
  const productInput = {
    operationId: PRODUCT_OPERATION_ID,
    externalId: PRODUCT_REFERENCE,
    name: 'TESTE Qoro - recorrencia apos trial local',
    amountMinor: 100,
    cycle: 'MONTHLY' as const,
  };
  const product = await commands.createProduct(productInput);
  const checkoutInput = {
    operationId: CHECKOUT_OPERATION_ID,
    externalId: CHECKOUT_REFERENCE,
    productId: product.id,
    expectedAmountMinor: 100,
    expectedCycle: 'MONTHLY' as const,
    expectedNativeTrialDays: null,
  };
  const checkout = await commands.createSubscriptionCheckout(checkoutInput);
  const subscriptions = await reader.listSubscriptionsForCheckout(checkout.checkoutId);
  if (subscriptions.length !== 0) throw new GatewayReadError('binding_mismatch');
  const financials = await reader.readSubscriptionCheckoutFinancials(checkout.checkoutId);
  if (
    financials.status !== 'PENDING' ||
    financials.paidAmount !== null ||
    financials.amount !== 100 ||
    financials.customerId !== null ||
    financials.items.length !== 1 ||
    financials.items[0]?.id !== product.id ||
    financials.items[0]?.quantity !== 1
  )
    throw new GatewayReadError('binding_mismatch');
  const postsBeforeReplay = trace.filter((item) => item.method === 'POST').length;
  const replayedProduct = await commands.createProduct(productInput);
  const replayedCheckout = await commands.createSubscriptionCheckout(checkoutInput);
  if (
    replayedProduct.id !== product.id ||
    replayedCheckout.checkoutId !== checkout.checkoutId ||
    trace.filter((item) => item.method === 'POST').length !== postsBeforeReplay
  ) {
    throw new GatewayReadError('binding_mismatch');
  }
  const evidence = {
    observedAt: new Date().toISOString(),
    runId: RUN_ID,
    sandbox: 'PASS',
    product: {
      id: product.id,
      amountMinor: product.price,
      cycle: product.cycle,
      nativeTrialDays: product.trialDays,
    },
    checkout: {
      id: checkout.checkoutId,
      amountMinor: checkout.amountMinor,
      state: checkout.state,
      providerStatus: financials.status,
      paidAmountMinor: financials.paidAmount,
    },
    subscriptionsFound: subscriptions.length,
    replayWithoutAdditionalPost: true,
    getRequests: trace.filter((item) => item.method === 'GET').length,
    postRequests: postsBeforeReplay,
    trace,
    fixturesRetained: true,
    externalPayment: 'NOT RUN',
    externalWebhook: 'NOT RUN',
    qoroEndToEnd: 'NOT RUN',
  };
  await writeFile(
    path.join(directory, `result-${randomUUID()}.json`),
    JSON.stringify(evidence, null, 2),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        runId: RUN_ID,
        status: 'BLOCKED',
        code:
          error instanceof CommandOperationError || error instanceof GatewayReadError
            ? error.code
            : 'sandbox_draft_failed_details_suppressed',
        trace,
        action: 'preserve_journal_and_reconcile_do_not_resend_with_new_operation_ids',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
