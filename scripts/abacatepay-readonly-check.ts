/** Only GET: does not load the application's DB/Auth configuration or mutate providers. */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';

import { createAbacatePayReadClient } from '../src/lib/payments/abacatepay/reader';
import { GatewayReadError } from '../src/lib/payments/saas/contracts';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'env-file': { type: 'string', default: '.env.local' },
      'product-id': { type: 'string' },
    },
    strict: true,
  });
  let apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) {
    const content = await readFile(values['env-file'], 'utf8');
    apiKey = parse(content).ABACATEPAY_API_KEY;
  }
  if (!apiKey) throw new GatewayReadError('invalid_input');
  const client = createAbacatePayReadClient({ apiKey, environment: 'sandbox' });
  await client.readStore();
  const products = values['product-id']
    ? [await client.readProduct(values['product-id'])]
    : await client.listProducts();
  const checkouts = await client.listSubscriptionCheckouts();
  const sandboxAttested = products.length + checkouts.length > 0;
  console.log(
    JSON.stringify(
      {
        authentication: 'PASS',
        sandbox: sandboxAttested ? 'PASS' : 'BLOCKED',
        reason: sandboxAttested ? 'resources_returned_devMode_true' : 'no_resource_with_devMode',
        products: products.length,
        subscriptionCheckouts: checkouts.length,
        mutations: 0,
      },
      null,
      2,
    ),
  );
  if (!sandboxAttested) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'BLOCKED',
      code: error instanceof GatewayReadError ? error.code : 'preflight_failed_details_suppressed',
      mutations: 0,
    }),
  );
  process.exitCode = 1;
});
