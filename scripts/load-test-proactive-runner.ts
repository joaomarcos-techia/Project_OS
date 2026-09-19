import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { assertEphemeralScratchTarget, assertLoadTestConfirmation } from './load-test-guards';

interface SeedResult {
  clinicId: string;
}

interface RunnerResult {
  sent: number;
  cancelled: number;
  retried: number;
  failed: number;
  batches: number;
  replayScanned: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

async function main(): Promise<void> {
  assertLoadTestConfirmation(process.env.LOAD_TEST_CONFIRM);
  const databaseUrl = process.env.DATABASE_URL;
  const sourceUrl = process.env.LOAD_TEST_SCHEMA_SOURCE;
  const seedPath = process.env.LOAD_TEST_SEED_PATH;
  const resultPath = process.env.LOAD_TEST_RESULT_PATH;
  const expected = Number(process.env.LOAD_TEST_EXPECTED_JOBS);
  if (!databaseUrl || !sourceUrl || !seedPath || !resultPath || !Number.isInteger(expected)) {
    throw new Error('[load:jobs] ambiente do runner incompleto.');
  }
  assertEphemeralScratchTarget(databaseUrl, sourceUrl);
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedResult;
  if (!seed.clinicId) throw new Error('[load:jobs] fixture sem clinicId.');

  const { processProactiveBatch } =
    await import('@/contexts/ai-agent/proactive-jobs/application/process');

  const concurrency = 5;
  const batchSize = 50;
  const durations: number[] = [];
  let sent = 0;
  let cancelled = 0;
  let retried = 0;
  let failed = 0;
  let batches = 0;

  while (sent + cancelled + retried + failed < expected) {
    const wave = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const started = performance.now();
        const summary = await processProactiveBatch('reminder', { batchSize });
        durations.push(performance.now() - started);
        return summary;
      }),
    );
    batches += wave.length;
    const scanned = wave.reduce((total, item) => total + item.scanned, 0);
    sent += wave.reduce((total, item) => total + item.sent, 0);
    cancelled += wave.reduce((total, item) => total + item.cancelled, 0);
    retried += wave.reduce((total, item) => total + item.retried, 0);
    failed += wave.reduce((total, item) => total + item.failed, 0);
    if (scanned === 0) break;
  }

  const replay = await Promise.all([
    processProactiveBatch('reminder', { batchSize }),
    processProactiveBatch('reminder', { batchSize }),
  ]);
  const result: RunnerResult = {
    sent,
    cancelled,
    retried,
    failed,
    batches,
    replayScanned: replay.reduce((total, item) => total + item.scanned, 0),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max(0, ...durations),
  };
  writeFileSync(resultPath, JSON.stringify(result), { encoding: 'utf8' });

  // Os pools do runtime têm idle_timeout deliberado. O runner é descartável e
  // já escreveu o resultado; sair evita transformar esse timeout em custo do gate.
  setTimeout(() => process.exit(0), 25).unref();
}

main().catch((error) => {
  process.stderr.write(
    `[load:jobs] FAILED: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 25).unref();
});
