import { execFileSync } from 'node:child_process';
import path from 'node:path';

function runFixture(command: 'setup' | 'cleanup'): void {
  execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      path.join('node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/e2e-mutation-fixture.ts',
      command,
    ],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  );
}

export default async function setupMutationE2E(): Promise<() => void> {
  runFixture('setup');
  return () => runFixture('cleanup');
}
