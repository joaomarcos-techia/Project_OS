import { createHash } from 'node:crypto';

const FINGERPRINT_PREFIX = 'sha256:';
const FINGERPRINT_CONTEXT = 'qoro:asaas-sandbox-fixture-account:v1:';
type AccountIdentity = { email: string | null };

function normalizedAccountEmail(account: AccountIdentity): string {
  const email = account.email?.trim().toLowerCase();
  if (!email)
    throw new Error('conta Asaas sem e-mail: proveniencia da fixture nao pode ser provada');
  return email;
}

/**
 * Identificador local e nao reversivel da conta que criou uma fixture Sandbox.
 * O e-mail em claro nunca entra no manifesto nem nos logs do runner.
 */
export function fingerprintAsaasAccount(account: AccountIdentity): string {
  const digest = createHash('sha256')
    .update(`${FINGERPRINT_CONTEXT}${normalizedAccountEmail(account)}`, 'utf8')
    .digest('hex');
  return `${FINGERPRINT_PREFIX}${digest}`;
}

export function assertAsaasFixtureAccount(
  expectedFingerprint: string,
  account: AccountIdentity,
): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedFingerprint)) {
    throw new Error('fingerprint de conta Asaas ausente ou malformado no manifesto');
  }
  if (fingerprintAsaasAccount(account) !== expectedFingerprint) {
    throw new Error('fixture pertence a outra conta Asaas Sandbox');
  }
}
