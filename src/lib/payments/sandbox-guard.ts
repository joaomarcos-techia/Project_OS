/**
 * Trava para scripts e testes que falam com gateway de pagamento (R23 do plano
 * de convênios): só libera SANDBOX, e na dúvida recusa.
 *
 * Motivo: no `.env.local` do desenvolvedor, as variáveis `ASAAS_*` sem sufixo
 * apontam para PRODUÇÃO. Um script de teste que as lesse por engano cadastraria
 * ou cobraria de verdade. Esta trava:
 *  - lê só as variáveis com sufixo `_DEV` (nunca as sem sufixo nem as `_PROD`);
 *  - exige host de sandbox conhecido E chave de homologação;
 *  - recusa se qualquer sinal de produção aparecer.
 *
 * Pura (recebe o texto do env); não lê arquivo nem rede.
 */
export class SandboxGuardError extends Error {
  constructor(message: string) {
    super(`[sandbox-guard] ${message}`);
    this.name = 'SandboxGuardError';
  }
}

const ASAAS_SANDBOX_HOSTS = new Set(['sandbox.asaas.com', 'api-sandbox.asaas.com']);

export interface AsaasSandboxCredentials {
  baseUrl: string;
  apiKey: string;
}

/** Confere URL e chave; lança `SandboxGuardError` se não forem inequivocamente de sandbox. */
export function assertAsaasSandbox(creds: AsaasSandboxCredentials): AsaasSandboxCredentials {
  let url: URL;
  try {
    url = new URL(creds.baseUrl);
  } catch {
    throw new SandboxGuardError('URL do gateway inválida');
  }
  if (url.protocol !== 'https:' || !ASAAS_SANDBOX_HOSTS.has(url.hostname)) {
    throw new SandboxGuardError(`host ${url.hostname} não é sandbox do Asaas`);
  }
  if (!creds.apiKey.includes('aact_hmlg')) {
    throw new SandboxGuardError('a chave não é de homologação ($aact_hmlg)');
  }
  if (creds.apiKey.includes('aact_prod')) {
    throw new SandboxGuardError('a chave tem marca de produção');
  }
  return creds;
}

function readVar(envText: string, name: string): string {
  const m = new RegExp(`^${name}=(.*)$`, 'mu').exec(envText);
  return (m?.[1] ?? '').replace(/^["']|["']$/gu, '').trim();
}

/** Lê do texto do env SÓ `ASAAS_BASE_URL_DEV` e `ASAAS_API_KEY_DEV`, e aplica a trava. */
export function loadAsaasSandboxCredentials(envText: string): AsaasSandboxCredentials {
  const baseUrl = readVar(envText, 'ASAAS_BASE_URL_DEV');
  const apiKey = readVar(envText, 'ASAAS_API_KEY_DEV');
  if (!baseUrl || !apiKey) {
    throw new SandboxGuardError(
      'ASAAS_BASE_URL_DEV e ASAAS_API_KEY_DEV são obrigatórias (sem fallback)',
    );
  }
  return assertAsaasSandbox({ baseUrl, apiKey });
}
