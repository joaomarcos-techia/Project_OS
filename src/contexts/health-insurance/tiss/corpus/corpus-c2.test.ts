import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TerminologyTerm } from '../terminology/official-sheet';
import { inMemoryLookup } from '../terminology/lookup';
import { checkTissEncoding } from '../xml/encoding-check';
import { verifyEpilogueHash } from '../xml/hash-verify';

import { C2_SCENARIOS, CORPUS_C2_DIR } from './scenarios-c2';

const TERMS = path.join(process.cwd(), 'data/tiss/terminologia/202609');
const table = (n: string): TerminologyTerm[] =>
  (JSON.parse(readFileSync(path.join(TERMS, `tab-${n}.json`), 'utf8')) as { terms: TerminologyTerm[] }).terms;
const terminology = inMemoryLookup(
  '202609',
  Object.fromEntries(['22', '23', '24', '26', '38', '59', '87'].map((n) => [n, table(n)])),
);
const dir = path.join(process.cwd(), CORPUS_C2_DIR);
const manifest = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')) as {
  scenarios: Array<{ id: string; file: string; sha256: string; rejectedBy: string[] }>;
};
const results = (name: string) =>
  JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
    tool: string;
    results: Array<{ id: string; sha256: string; asExpected: boolean; xsdValid: boolean }>;
  };

describe('corpus c2 — solicitação SP/SADT e recurso de glosa (P13.1)', () => {
  it('o manifesto lista exatamente os cenários do código, com os mesmos arquivos', () => {
    expect(manifest.scenarios.map((s) => s.id)).toEqual(C2_SCENARIOS.map((s) => s.id));
  });

  it.each(C2_SCENARIOS.map((s) => [s.id, s] as const))('%s: regenerado byte a byte', (_id, s) => {
    const built = s.build();
    const entry = manifest.scenarios.find((m) => m.id === s.id)!;
    expect(createHash('sha256').update(built.bytes).digest('hex')).toBe(entry.sha256);
    expect(readFileSync(path.join(dir, s.file)).equals(built.bytes)).toBe(true);
  });

  it.each(C2_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: camada interna, hash do epílogo e codificação conforme o oráculo',
    (_id, s) => {
      const built = s.build();
      const issues = s.validate(terminology);
      expect(issues.length > 0, issues.map((i) => i.code).join(',')).toBe(s.rejectedBy.includes('internal'));
      const hash = verifyEpilogueHash(built.bytes);
      expect([hash.matches, hash.computed]).toEqual([true, built.hash]);
      expect(checkTissEncoding(built.bytes)).toBeNull();
    },
  );

  it.each(['XSD_RESULTS.json', 'XSD_RESULTS_DOTNET.json'])(
    '%s: o XSD oficial (motor independente) concorda com o oráculo em todos os arquivos',
    (name) => {
      const r = results(name);
      expect(r.results.map((x) => x.id)).toEqual(manifest.scenarios.map((s) => s.id));
      for (const x of r.results) {
        const entry = manifest.scenarios.find((m) => m.id === x.id)!;
        expect([x.id, x.sha256, x.asExpected, x.xsdValid]).toEqual([
          x.id,
          entry.sha256,
          true,
          !entry.rejectedBy.includes('xsd'),
        ]);
      }
    },
  );

  it('nada clínico é inventado: sem CID em nenhum arquivo; indicação clínica só onde foi escrita', () => {
    for (const s of C2_SCENARIOS) {
      const xml = s.build().xml;
      expect(xml).not.toMatch(/<ans:(?:CID|cid|codigoDiagnostico|diagnostico)\b/u);
    }
    expect(C2_SCENARIOS.find((s) => s.id === 'R02-solicitacao-sem-indicacao')!.build().xml).not.toContain('indicacaoClinica');
  });
});
