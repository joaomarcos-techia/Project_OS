import { execFileSync } from 'node:child_process';

/** Git tar member names are UTF8; Windows bsdtar otherwise uses the local code page. */
export function extractReleaseArchive(archive: string, directory: string): void {
  execFileSync(
    'tar',
    [
      ...(process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : []),
      '-xf',
      archive,
      '-C',
      directory,
    ],
    { windowsHide: true },
  );
}
