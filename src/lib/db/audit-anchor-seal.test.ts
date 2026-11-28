import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ANCHOR_GENESIS, chainDay, type DayAnchor } from './audit-anchor';
import {
  SEAL_VERSION,
  buildSeal,
  checkAnchorFile,
  checkSeal,
  sealDigest,
  sealHeads,
  sealStatement,
  sealWindow,
} from './audit-anchor-seal';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

function chain(trail: DayAnchor['trail'], days: string[], salt = 'x'): DayAnchor[] {
  let prev = ANCHOR_GENESIS;
  return days.map((day) => {
    const digest = chainDay(prev, trail, day, [h(`${salt}${day}`)]);
    const a = { trail, day, count: 1, prev, digest };
    prev = digest;
    return a;
  });
}
const DAYS = ['2026-11-25', '2026-11-26', '2026-11-27'];

describe('S5 — consistência do arquivo de âncoras (sem o banco)', () => {
  it('cadeia íntegra: nenhum achado', () => {
    expect(checkAnchorFile(chain('clinic_audit', DAYS))).toEqual([]);
  });

  it('vazio, dia pulado, elo quebrado, início fora do gênese, trilhas misturadas e linha malformada', () => {
    const c = chain('clinic_audit', DAYS);
    expect(checkAnchorFile([])).toEqual([{ kind: 'empty' }]);
    expect(checkAnchorFile([c[0]!, c[2]!])).toEqual(
      expect.arrayContaining([
        { kind: 'day_gap', day: DAYS[2] },
        { kind: 'chain_broken', day: DAYS[2] },
      ]),
    );
    expect(checkAnchorFile(c.slice(1))).toEqual([{ kind: 'wrong_start', day: DAYS[1] }]);
    expect(checkAnchorFile(c.slice(1), c[0]!.digest)).toEqual([]);
    expect(checkAnchorFile([c[0]!, { ...c[1]!, trail: 'platform_audit' }])).toContainEqual({
      kind: 'mixed_trails',
    });
    expect(checkAnchorFile([{ ...c[0]!, digest: 'zz' }])).toContainEqual({
      kind: 'malformed',
      index: 0,
    });
  });
});

describe('S5 — enunciado e selo', () => {
  const clinic = chain('clinic_audit', DAYS, 'c');
  const platform = chain('platform_audit', DAYS, 'p');

  it('enunciado canônico: uma linha por trilha em ordem de trilha, independente da ordem dos arquivos', () => {
    const a = sealStatement(sealHeads([platform, clinic]));
    const b = sealStatement(sealHeads([clinic, platform]));
    expect(a).toBe(b);
    expect(a.split('\n')).toEqual([
      SEAL_VERSION,
      `clinic_audit ${DAYS[0]} ${DAYS[2]} ${clinic[2]!.digest}`,
      `platform_audit ${DAYS[0]} ${DAYS[2]} ${platform[2]!.digest}`,
    ]);
    expect(sealDigest(a)).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => sealHeads([clinic, clinic])).toThrow('mesma trilha');
    expect(() => sealHeads([[]])).toThrow('vazio');
  });

  it('selo íntegro: nenhum achado', () => {
    const seal = buildSeal([clinic, platform], [{ tsa: 't', response: 'AA==' }]);
    expect(checkSeal(seal, [clinic, platform])).toEqual([]);
  });

  it('acusa versão, enunciado editado, ausência de carimbo e a trilha que mudou', () => {
    const seal = buildSeal([clinic, platform], [{ tsa: 't', response: 'AA==' }]);
    expect(checkSeal({ ...seal, version: 'outra' as never }, [clinic, platform])).toContainEqual({
      kind: 'version',
    });
    expect(
      checkSeal({ ...seal, statement: `${seal.statement} ` }, [clinic, platform]),
    ).toContainEqual({ kind: 'digest_mismatch' });
    expect(checkSeal({ ...seal, tokens: [] }, [clinic, platform])).toEqual([{ kind: 'no_token' }]);
    const rewritten = chain('clinic_audit', DAYS, 'reescrita');
    expect(checkSeal(seal, [rewritten, platform])).toEqual([
      { kind: 'statement_mismatch', trail: 'clinic_audit' },
    ]);
    expect(checkSeal(seal, [clinic])).toEqual([{ kind: 'statement_mismatch' }]);
    expect(checkSeal(seal, [clinic, clinic])).toEqual([{ kind: 'statement_mismatch' }]);
  });

  it('janela do carimbo: dentro do prazo e atrasado', () => {
    const heads = sealHeads([clinic]);
    expect(sealWindow(heads, new Date('2026-11-28T06:00:00Z'))).toEqual({ hours: 6, late: false });
    expect(sealWindow(heads, new Date('2026-12-02T00:00:00Z'))).toEqual({ hours: 96, late: true });
    expect(sealWindow(heads, new Date('2026-11-28T10:00:00Z'), 4).late).toBe(true);
  });
});
