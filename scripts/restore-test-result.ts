/** O runner automatizado só pode escrever num banco local dedicado ao restore. */
export function assertLocalScratchTarget(target: string): void {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error('RESTORE_TARGET_URL inválida');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const databaseName = url.pathname.slice(1);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !localHosts.has(url.hostname) ||
    !/^qoro_restore_[a-z0-9_]+$/i.test(databaseName)
  ) {
    throw new Error(
      '[guard] restore:test exige PostgreSQL local e banco nomeado qoro_restore_*; alvo remoto ou genérico recusado',
    );
  }
}

export function assertRestoreExit(status: number | null, error?: Error): void {
  if (error) throw new Error('não foi possível iniciar o psql para restaurar o dump');
  if (status !== 0) {
    throw new Error(`psql terminou com status ${status ?? 'indeterminado'}; restore incompleto`);
  }
}
