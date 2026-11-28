/**
 * Manifesto do corpus: o que foi gerado, com que bytes e o que se espera de
 * cada camada. É a referência para registrar resultados externos (G.6): o
 * SHA-256 do arquivo submetido tem de bater com o daqui.
 */
import { createHash } from 'node:crypto';

import { CORPUS_ID, CORPUS_TODAY, type CorpusLayer, type CorpusScenario } from './scenarios';

export interface CorpusManifestEntry {
  id: string;
  file: string | null;
  sha256: string | null;
  bytes: number | null;
  matrix: string[];
  guideType: CorpusScenario['guideType'];
  title: string;
  expected: CorpusScenario['expected'];
  rejectedBy: CorpusLayer[];
  expectedIssues: string[];
  origin: CorpusScenario['origin'];
  mutation: string | null;
}

export interface CorpusManifest {
  corpus: string;
  standard: 'TISS';
  version: '4.03.00';
  today: string;
  /** Aviso fixo: dados fictícios. */
  data: 'sintéticos';
  scenarios: CorpusManifestEntry[];
}

export function corpusManifest(scenarios: readonly CorpusScenario[]): CorpusManifest {
  return {
    corpus: CORPUS_ID,
    standard: 'TISS',
    version: '4.03.00',
    today: CORPUS_TODAY,
    data: 'sintéticos',
    scenarios: scenarios.map((s) => {
      const bytes = s.bytes();
      return {
        id: s.id,
        file: bytes ? `${s.id}.xml` : null,
        sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
        bytes: bytes ? bytes.length : null,
        matrix: s.matrix,
        guideType: s.guideType,
        title: s.title,
        expected: s.expected,
        rejectedBy: s.rejectedBy,
        expectedIssues: s.expectedIssues ?? [],
        origin: s.origin,
        mutation: s.mutation ?? null,
      };
    }),
  };
}
