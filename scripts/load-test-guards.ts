import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const CONFIRMATION = 'LOCAL_SCRATCH_ONLY';
const SCRATCH_DATABASE_PREFIX = 'clinicaos_load_';
const SCRATCH_DIRECTORY_PREFIX = 'clinicaos-load-';

export function assertLoadTestConfirmation(value: string | undefined): void {
  if (value !== CONFIRMATION) {
    throw new Error(
      `[guard] LOAD_TEST_CONFIRM deve ser exatamente "${CONFIRMATION}". ` +
        'A carga nunca roda por confirmação implícita.',
    );
  }
}

export function assertSafeSchemaSource(input: {
  sourceUrl: string | undefined;
  productionUrl?: string | undefined;
  projectEnv?: string | undefined;
}): URL {
  if (!input.sourceUrl) {
    throw new Error('[guard] DATABASE_URL_DEV/DATABASE_URL ausente para extrair somente o schema.');
  }
  if (input.projectEnv === 'prod') {
    throw new Error('[guard] SUPABASE_PROJECT_ENV=prod. A prova de carga foi abortada.');
  }

  const url = new URL(input.sourceUrl);
  if (input.productionUrl) {
    const productionUrl = new URL(input.productionUrl);
    const sourceTarget = `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
    const productionTarget = `${productionUrl.hostname.toLowerCase()}:${productionUrl.port || '5432'}${productionUrl.pathname}`;
    if (sourceTarget === productionTarget) {
      throw new Error('[guard] a origem do schema coincide com DATABASE_URL_PROD. Abortando.');
    }
  }
  if (/(^|[.-])(prod|production)([.-]|$)/iu.test(url.hostname)) {
    throw new Error('[guard] a origem do schema parece produção pelo hostname. Abortando.');
  }
  if (url.searchParams.get('sslmode') !== 'require') {
    throw new Error('[guard] a origem do schema deve exigir TLS com sslmode=require.');
  }
  return url;
}

export function assertEphemeralScratchTarget(targetUrl: string, sourceUrl: string): URL {
  if (targetUrl === sourceUrl) {
    throw new Error('[guard] o alvo scratch coincide com a origem do schema. Abortando.');
  }

  const url = new URL(targetUrl);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('[guard] o alvo da carga deve estar no loopback local.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!database.startsWith(SCRATCH_DATABASE_PREFIX)) {
    throw new Error(`[guard] o banco scratch deve começar com "${SCRATCH_DATABASE_PREFIX}".`);
  }
  if (url.searchParams.get('sslmode') !== 'require') {
    throw new Error('[guard] o scratch local deve usar TLS com sslmode=require.');
  }
  return url;
}

export function assertEphemeralTempDirectory(targetPath: string, tempRoot: string): string {
  const resolvedTarget = resolve(targetPath);
  const resolvedRoot = resolve(tempRoot);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);
  const outsideRoot =
    !relativeTarget ||
    isAbsolute(relativeTarget) ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`);
  if (outsideRoot || !basename(resolvedTarget).startsWith(SCRATCH_DIRECTORY_PREFIX)) {
    throw new Error(`[guard] recusada remoção do diretório temporário: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

export const LOAD_TEST_GUARD_CONSTANTS = {
  confirmation: CONFIRMATION,
  scratchDatabasePrefix: SCRATCH_DATABASE_PREFIX,
  scratchDirectoryPrefix: SCRATCH_DIRECTORY_PREFIX,
} as const;
