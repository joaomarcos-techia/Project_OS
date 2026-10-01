import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function e2eSpecs(dir: string): string[] {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return e2eSpecs(relative);
    return entry.name.endsWith('.spec.ts') ? [relative] : [];
  });
}

describe('política de artefatos E2E autenticados', () => {
  it('mantém trace, screenshot e vídeo desligados sem opt-in', () => {
    const configs = ['playwright.config.ts', 'playwright.ci.config.ts'];

    for (const file of configs) {
      const config = read(file);
      expect(config, file).toContain("trace: retainAllArtifacts ? 'on' : 'off'");
      expect(config, file).toContain("screenshot: retainAllArtifacts ? 'on' : 'off'");
      expect(config, file).toContain("video: retainAllArtifacts ? 'on' : 'off'");
    }
  });

  it('nenhum spec contorna a política global com captura automática', () => {
    const offenders = e2eSpecs('e2e').filter((file) => {
      const source = read(file);
      return /(?:trace|video|screenshot):\s*['"](?:on|retain-on-failure|only-on-failure)['"]/u.test(
        source,
      );
    });

    expect(offenders).toEqual([]);
  });
});
