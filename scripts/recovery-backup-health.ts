import { readFile } from 'node:fs/promises';
import { evaluateRecoveryHealth, parseRecoveryCopies } from '../src/lib/backup/recovery-health';
async function main(): Promise<void> {
  const filename = process.env.RECOVERY_HEALTH_FILE;
  if (!filename) throw new Error('Recovery inventory not configured');
  const data = await readFile(filename);
  if (data.length > 4 * 1024 * 1024) throw new Error('Recovery inventory too large');
  const status = evaluateRecoveryHealth(
    parseRecoveryCopies(JSON.parse(data.toString('utf8'))),
    Date.now(),
  );
  process.stdout.write(JSON.stringify(status) + '\n');
  if (status.status !== 'PASS') process.exitCode = 1;
}
main().catch(() => {
  process.stderr.write('FAIL recovery health inventory; no secret details logged\n');
  process.exitCode = 1;
});
