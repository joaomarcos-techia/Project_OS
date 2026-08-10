import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve a package binary from this repository instead of assuming that the
 * package manager has added node_modules/.bin to PATH. Production scripts are
 * run directly by operators too, where that assumption is not valid.
 */
export function localBinCommand(
  name: string,
  platform: NodeJS.Platform = process.platform,
  repoRoot: string = process.cwd(),
): string {
  const executable = resolve(
    repoRoot,
    'node_modules',
    '.bin',
    platform === 'win32' ? `${name}.cmd` : name,
  );

  if (!existsSync(executable)) {
    throw new Error(
      `Required local binary is missing: ${executable}. Run the project dependency install first.`,
    );
  }

  // Quotes are required for Windows paths such as "Program Files" when this
  // command is subsequently executed through execSync's shell.
  return `"${executable}"`;
}
