import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertAsaasFixtureAccount, fingerprintAsaasAccount } from './asaas-account-provenance';

describe('proveniencia de fixtures Asaas Sandbox', () => {
  it('normaliza o e-mail antes de gerar um fingerprint sem PII em claro', () => {
    const fingerprint = fingerprintAsaasAccount({ email: ' Conta@Example.COM ' });

    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain('conta@example.com');
    expect(fingerprint).toBe(fingerprintAsaasAccount({ email: 'conta@example.com' }));
  });

  it('reprova conta diferente antes de operar a fixture', () => {
    const expected = fingerprintAsaasAccount({ email: 'conta-a@example.com' });

    expect(() => assertAsaasFixtureAccount(expected, { email: 'conta-b@example.com' })).toThrow(
      'fixture pertence a outra conta Asaas Sandbox',
    );
  });

  it('reprova identidade ausente ou manifesto malformado', () => {
    expect(() => fingerprintAsaasAccount({ email: null })).toThrow('proveniencia');
    expect(() =>
      assertAsaasFixtureAccount('conta-a@example.com', { email: 'a@example.com' }),
    ).toThrow('malformado');
  });

  it('mantém os runners live presos ao Sandbox e com cleanup comprovável', () => {
    for (const file of ['scripts/asaas-live-check.ts', 'scripts/payments-live-check.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} perdeu a allowlist do Sandbox`).toContain('api-sandbox.asaas.com');
      expect(source, `${file} perdeu o readback de cleanup`).toMatch(/readback/u);
      expect(source, `${file} passou a aceitar produção`).not.toContain("'api.asaas.com'");
    }

    const paymentsSource = readFileSync('scripts/payments-live-check.ts', 'utf8');
    expect(paymentsSource).toContain('undoReceivedInCash');
    expect(paymentsSource).toContain('notifyCustomer: false');
  });
});
