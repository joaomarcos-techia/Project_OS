import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

type Environment = Readonly<Record<string, string | undefined>>;

type RequiredGroup = {
  label: string;
  names: readonly string[];
};

export const SIGNUP_E2E_ENV_ALIASES = {
  supabaseUrl: ['NEXT_PUBLIC_SUPABASE_URL_DEV', 'SUPABASE_URL_DEV', 'NEXT_PUBLIC_SUPABASE_URL'],
  supabaseAdminKey: ['SUPABASE_SECRET_KEY_DEV', 'SUPABASE_SERVICE_ROLE_KEY_DEV', 'SECRET_KEY_DEV'],
  supabasePublicKey: [
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ],
  magicTokenSecret: ['MAGIC_TOKEN_SECRET_DEV', 'MAGIC_TOKEN_SECRET'],
  loginHashPepper: ['LOGIN_HASH_PEPPER_DEV', 'LOGIN_HASH_PEPPER'],
} as const;

const REQUIRED_EXTERNAL_ENV: readonly RequiredGroup[] = [
  { label: 'E2E_BASE_URL', names: ['E2E_BASE_URL'] },
  {
    label: 'URL do Supabase DEV',
    names: SIGNUP_E2E_ENV_ALIASES.supabaseUrl,
  },
  {
    label: 'chave administrativa do Supabase DEV',
    names: SIGNUP_E2E_ENV_ALIASES.supabaseAdminKey,
  },
  {
    label: 'chave pública do Supabase DEV',
    names: SIGNUP_E2E_ENV_ALIASES.supabasePublicKey,
  },
  { label: 'RESEND_API_KEY_DEV', names: ['RESEND_API_KEY_DEV'] },
  { label: 'EMAIL_FROM_DEV', names: ['EMAIL_FROM_DEV'] },
  { label: 'DATABASE_URL_DEV', names: ['DATABASE_URL_DEV'] },
  { label: 'ASAAS_BASE_URL do Sandbox', names: ['ASAAS_BASE_URL_DEV', 'ASAAS_BASE_URL'] },
  { label: 'ASAAS_API_KEY do Sandbox', names: ['ASAAS_API_KEY_DEV', 'ASAAS_API_KEY'] },
  {
    label: 'MAGIC_TOKEN_SECRET do DEV',
    names: SIGNUP_E2E_ENV_ALIASES.magicTokenSecret,
  },
  {
    label: 'LOGIN_HASH_PEPPER do DEV',
    names: SIGNUP_E2E_ENV_ALIASES.loginHashPepper,
  },
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const SIGNUP_E2E_DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';

function supabaseProjectRef(environment: Environment): string | null {
  const raw = firstConfiguredValue(environment, SIGNUP_E2E_ENV_ALIASES.supabaseUrl);
  if (!raw) return null;
  try {
    return /^([a-z0-9]+)\.supabase\.co$/u.exec(new URL(raw).hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function databaseProjectRef(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const username = decodeURIComponent(url.username);
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(hostname);
    if (direct && username === 'postgres') return direct[1] ?? null;
    const poolerUser = /^postgres\.([a-z0-9]+)$/u.exec(username);
    return /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(hostname) && poolerUser
      ? (poolerUser[1] ?? null)
      : null;
  } catch {
    return null;
  }
}

function present(environment: Environment, name: string): boolean {
  return Boolean(environment[name]?.trim());
}

export function firstConfiguredValue(
  environment: Environment,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function hasAny(environment: Environment, names: readonly string[]): boolean {
  return firstConfiguredValue(environment, names) !== undefined;
}

export function signupConfirmationE2EGuardErrors(environment: Environment): string[] {
  const errors: string[] = [];

  if (environment.E2E_SIGNUP_WRITE !== '1') {
    errors.push('E2E_SIGNUP_WRITE=1 é obrigatório para autorizar a escrita descartável');
  }

  for (const group of REQUIRED_EXTERNAL_ENV) {
    if (!hasAny(environment, group.names)) {
      errors.push(`configuração obrigatória ausente: ${group.label}`);
    }
  }

  if (supabaseProjectRef(environment) !== SIGNUP_E2E_DEV_PROJECT_REF) {
    errors.push('a URL do Supabase precisa apontar para o projeto DEV fixado no runner');
  }
  if (databaseProjectRef(environment.DATABASE_URL_DEV) !== SIGNUP_E2E_DEV_PROJECT_REF) {
    errors.push('DATABASE_URL_DEV precisa apontar para o projeto DEV fixado no runner');
  }

  const rawBaseUrl = environment.E2E_BASE_URL?.trim();
  if (!rawBaseUrl) return errors;

  let target: URL;
  try {
    target = new URL(rawBaseUrl);
  } catch {
    errors.push('E2E_BASE_URL não é uma URL válida');
    return errors;
  }

  const targetHostname = target.hostname.toLowerCase().replace(/\.+$/u, '');
  if (targetHostname === 'qoro.dev' || targetHostname.endsWith('.qoro.dev')) {
    errors.push('o runner recusa qualquer origem de produção em qoro.dev');
    return errors;
  }

  const local = LOCAL_HOSTS.has(targetHostname);
  if (!local && target.protocol !== 'https:') {
    errors.push('um alvo remoto exige HTTPS');
  }

  if (environment.SUPABASE_PROJECT_ENV !== 'dev') {
    errors.push('SUPABASE_PROJECT_ENV=dev é obrigatório neste E2E');
  }

  const rawAsaasBaseUrl = firstConfiguredValue(environment, [
    'ASAAS_BASE_URL_DEV',
    'ASAAS_BASE_URL',
  ]);
  if (rawAsaasBaseUrl) {
    try {
      const asaas = new URL(rawAsaasBaseUrl);
      if (
        asaas.protocol !== 'https:' ||
        !['api-sandbox.asaas.com', 'sandbox.asaas.com'].includes(asaas.hostname)
      ) {
        errors.push('Asaas não corresponde ao Sandbox esperado');
      }
    } catch {
      errors.push('ASAAS_BASE_URL do Sandbox não é válida');
    }
  }

  if (local) {
    if (!present(environment, 'APP_BASE_URL')) {
      errors.push('configuração obrigatória ausente: APP_BASE_URL');
    } else {
      try {
        if (new URL(environment.APP_BASE_URL!.trim()).origin !== target.origin) {
          errors.push('APP_BASE_URL precisa ter a mesma origem de E2E_BASE_URL');
        }
      } catch {
        errors.push('APP_BASE_URL não é uma URL válida');
      }
    }
    for (const flag of ['SIGNUP_ENABLED', 'SIGNUP_IDENTITY_ENABLED', 'SIGNUP_AUTH_ENABLED']) {
      if (environment[flag] !== 'true') errors.push(`${flag}=true é obrigatório no alvo local`);
    }
    return errors;
  }

  if (environment.E2E_SIGNUP_ALLOW_PREVIEW !== '1') {
    errors.push('um Preview exige E2E_SIGNUP_ALLOW_PREVIEW=1');
  }
  const rawAllowedOrigin = environment.E2E_SIGNUP_ALLOWED_ORIGIN?.trim();
  if (!rawAllowedOrigin) {
    errors.push('um Preview exige E2E_SIGNUP_ALLOWED_ORIGIN');
  } else {
    try {
      if (new URL(rawAllowedOrigin).origin !== target.origin) {
        errors.push('E2E_SIGNUP_ALLOWED_ORIGIN precisa ser a origem exata de E2E_BASE_URL');
      }
    } catch {
      errors.push('E2E_SIGNUP_ALLOWED_ORIGIN não é uma URL válida');
    }
  }

  return errors;
}

export function assertSignupConfirmationE2EEnvironment(environment: Environment): void {
  const errors = signupConfirmationE2EGuardErrors(environment);
  if (errors.length === 0) return;

  throw new Error(
    ['[signup-confirmation-e2e] execução recusada:', ...errors.map((error) => `- ${error}`)].join(
      '\n',
    ),
  );
}

async function run(): Promise<number> {
  assertSignupConfirmationE2EEnvironment(process.env);

  const playwrightCli = path.resolve(
    process.cwd(),
    'node_modules',
    '@playwright',
    'test',
    'cli.js',
  );
  if (!existsSync(playwrightCli)) {
    throw new Error(
      '[signup-confirmation-e2e] Playwright local não encontrado; instale as dependências do projeto.',
    );
  }

  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        playwrightCli,
        'test',
        'e2e/signup-confirmation.spec.ts',
        '--project=chromium',
        '--workers=1',
        '--retries=0',
        '--reporter=list',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, E2E_SIGNUP_RUNNER: '1' },
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        reject(new Error(`[signup-confirmation-e2e] Playwright terminou por sinal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const directInvocation = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (directInvocation) {
  void run()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : '[signup-confirmation-e2e] falha desconhecida',
      );
      process.exitCode = 1;
    });
}
