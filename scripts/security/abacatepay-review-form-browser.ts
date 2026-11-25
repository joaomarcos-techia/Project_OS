/** Native Chromium constraint check of the actual TSX pattern; no session, account or external network. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const source = await readFile('src/app/(admin)/admin/billing/operacao/replay-form.tsx', 'utf8');
const pattern = source.match(/pattern="(\[A-Za-z0-9\][^"]+)"/)?.[1];
assert.ok(pattern, 'Missing incident reference constraint in the source form');
const browser = await chromium.launch({ headless: true });
let networkRequests = 0;
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    networkRequests++;
    return route.abort();
  });
  await page.setContent(`<input required pattern="${pattern}" minlength="8" maxlength="80">`);
  const field = page.locator('input');
  for (const [value, valid] of [
    ['INC-20261110-001', true],
    ['INC_20261110_001', true],
    ['address@example.invalid', false],
    ['https://example.invalid/receipt', false],
    ['short', false],
  ] as const) {
    await field.fill(value);
    assert.equal(
      await field.evaluate((element) => {
        if (!(element instanceof HTMLInputElement)) throw new Error('Expected an input element');
        return element.checkValidity();
      }),
      valid,
    );
  }
  assert.equal(networkRequests, 0);
  const result = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    browser: 'Chromium',
    checks: 5,
    networkRequests,
    scope: 'native_constraint_only_not_authenticated_admin_E2E',
  };
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/abacatepay-review-form-browser.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.info(JSON.stringify(result));
} finally {
  await browser.close();
}
