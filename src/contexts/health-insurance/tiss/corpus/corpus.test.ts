import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLoteGuiasMessage, type LoteGuiasInput } from '../messages/lote-guias';
import { inMemoryLookup } from '../terminology/lookup';
import type { TerminologyTerm } from '../terminology/official-sheet';
import { validateLoteGuias } from '../validation/batch-validator';
import { validateConsultaGuide } from '../validation/consulta-validator';
import { validateSpSadtGuide } from '../validation/sp-sadt-validator';
import { checkTissEncoding } from '../xml/encoding-check';
import { verifyEpilogueHash } from '../xml/hash-verify';

import { SYNTHETIC } from './fixtures';
import { corpusManifest, type CorpusManifest } from './manifest';
import { CORPUS_DIR, corpusScenarios, type CorpusScenario } from './scenarios';

const TERMS = path.join(process.cwd(), 'data/tiss/terminologia/202609');
const terminology = inMemoryLookup(
  '202609',
  Object.fromEntries(
    [
      '22',
      '23',
      '24',
      '26',
      '35',
      '36',
      '48',
      '50',
      '52',
      '59',
      '61',
      '74',
      '75',
      '76',
      '77',
      '87',
    ].map((n) => [
      n,
      (
        JSON.parse(readFileSync(path.join(TERMS, `tab-${n}.json`), 'utf8')) as {
          terms: TerminologyTerm[];
        }
      ).terms,
    ]),
  ),
);

const DIR = path.join(process.cwd(), CORPUS_DIR);
const scenarios = corpusScenarios();
const committed = JSON.parse(
  readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8'),
) as CorpusManifest;

function ruleCodes(s: CorpusScenario, input: LoteGuiasInput): string[] {
  const codes = validateLoteGuias(input).map((i) => i.code);
  if (input.lote.type === 'consulta') {
    for (const g of input.lote.guides) {
      codes.push(
        ...validateConsultaGuide(g, {
          terminology,
          contractorPerson: s.rules.contractorPerson,
          today: s.rules.today,
        }).map((i) => i.code),
      );
    }
  } else {
    for (const g of input.lote.guides) {
      codes.push(
        ...validateSpSadtGuide(g, {
          terminology,
          requesterPerson: s.rules.requesterPerson,
          today: s.rules.today,
          authorizationRequired: s.rules.authorizationRequired,
        }).map((i) => i.code),
      );
    }
  }
  return codes;
}

describe('corpus sintético TISS 4.03.00', () => {
  it('ids únicos e válidos não têm camada que recuse', () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const s of scenarios) {
      expect(s.expected === 'valid', s.id).toBe(s.rejectedBy.length === 0);
    }
  });

  it('o código regenera exatamente o manifesto e os arquivos versionados', () => {
    expect(corpusManifest(scenarios)).toEqual(committed);
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.xml'))
      .sort();
    const expected = committed.scenarios.flatMap((s) => (s.file ? [s.file] : [])).sort();
    expect(onDisk).toEqual(expected);
    for (const s of scenarios) {
      const bytes = s.bytes();
      if (!bytes) continue;
      const file = readFileSync(path.join(DIR, `${s.id}.xml`));
      expect(createHash('sha256').update(file).digest('hex'), s.id).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }
  });

  describe.each(scenarios.map((s) => [s.id, s] as const))('%s', (_id, s) => {
    const bytes = s.bytes();

    it('gerador: recusa só quando o cenário prevê', () => {
      if (!s.input) return;
      const build = () => buildLoteGuiasMessage(s.input!);
      if (s.rejectedBy.includes('builder')) expect(build).toThrow();
      else expect(build).not.toThrow();
    });

    it('regras: recusam só quando o cenário prevê, com o código esperado', () => {
      if (!s.input) return;
      const codes = ruleCodes(s, s.input);
      if (s.rejectedBy.includes('rules')) {
        expect(codes.length, s.id).toBeGreaterThan(0);
        for (const c of s.expectedIssues ?? []) expect(codes, s.id).toContain(c);
      } else {
        expect(codes, s.id).toEqual([]);
      }
    });

    it.skipIf(!bytes)('hash do epílogo: confere de forma independente', () => {
      expect(verifyEpilogueHash(bytes!).matches).toBe(!s.rejectedBy.includes('hash'));
    });

    it.skipIf(!bytes)('codificação: ISO-8859-1 coerente com os bytes', () => {
      const problem = checkTissEncoding(bytes!);
      if (s.rejectedBy.includes('encoding')) expect(problem).not.toBeNull();
      else expect(problem).toBeNull();
    });

    it.skipIf(!bytes)('sem CID e sem dado fora do conjunto sintético', () => {
      const text = bytes!.toString('latin1');
      expect(text).not.toMatch(/<ans:(cid|diagnostico|CID)/u);
      for (const m of text.matchAll(/<ans:numeroCarteira>([^<]*)</gu)) {
        expect([SYNTHETIC.carteira, '1'.repeat(21)]).toContain(m[1]);
      }
    });
  });

  it.each([
    ['libxml2 (xmllint-wasm)', 'XSD_RESULTS.json', 'scripts/tiss/corpus/validate-xsd.ts'],
    [
      '.NET System.Xml.Schema',
      'XSD_RESULTS_DOTNET.json',
      'scripts/tiss/corpus/validate-xsd-dotnet.ps1',
    ],
  ])(
    'o resultado XSD registrado (%s) corresponde ao corpus atual e à expectativa',
    (_engine, name, script) => {
      const file = path.join(DIR, name);
      expect(existsSync(file), `rode ${script}`).toBe(true);
      const recorded = JSON.parse(readFileSync(file, 'utf8')) as {
        results: Array<{ id: string; sha256: string; xsdValid: boolean }>;
      };
      const withFile = committed.scenarios.filter((s) => s.file);
      expect(recorded.results.map((r) => r.id).sort()).toEqual(withFile.map((s) => s.id).sort());
      for (const r of recorded.results) {
        const entry = withFile.find((s) => s.id === r.id)!;
        expect(r.sha256, r.id).toBe(entry.sha256);
        expect(r.xsdValid, r.id).toBe(!entry.rejectedBy.includes('xsd'));
      }
    },
  );
});
