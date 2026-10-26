export function assertRestoreExit(status: number | null, error?: Error): void {
  if (error) throw new Error('não foi possível iniciar o psql para restaurar o dump');
  if (status !== 0) {
    throw new Error(`psql terminou com status ${status ?? 'indeterminado'}; restore incompleto`);
  }
}
