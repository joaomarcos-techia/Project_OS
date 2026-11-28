import { vi } from 'vitest';

/**
 * Roda um harness de banco (`scripts/security/*-db.ts`, cada um com o próprio Postgres descartável) DENTRO do
 * Vitest, com o ambiente da linha de comando do workflow de provas de banco. Assim o código de `src/` que o harness
 * executa entra na cobertura pela MESMA instrumentação e no MESMO escopo da suíte unitária (`coverage.include`),
 * numa execução só: nada é somado de fora nem contado duas vezes.
 *
 * O harness é um script com `await` no topo: o `import()` só resolve quando ele termina. `process.exit` no fim do
 * script vira um registro (não derruba o processo do Vitest); qualquer código diferente de 0, ou exceção, reprova.
 */
export async function runHarness(
  load: () => Promise<unknown>,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const codes: number[] = [];
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    codes.push(Number(code ?? 0));
    return undefined as never;
  }) as typeof process.exit);
  try {
    await load();
  } finally {
    exit.mockRestore();
    vi.unstubAllEnvs();
  }
  const failed = codes.filter((code) => code !== 0);
  if (failed.length > 0) throw new Error(`o harness pediu process.exit(${failed.join(', ')})`);
}
