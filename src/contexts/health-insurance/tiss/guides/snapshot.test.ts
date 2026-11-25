import { describe, expect, it } from 'vitest';

import {
  GuideSnapshotError,
  canonicalJson,
  parseVerifiedGuideSnapshot,
  serializeGuideSnapshot,
  type GuideSnapshotContent,
} from './snapshot';

const content = {
  schema: 'qoro.hi.guide-snapshot/1',
  guideType: 'consulta',
  tissVersion: '4.03.00',
  terminologyVersion: '202609',
  data: { registroANS: '123456', numeroGuiaPrestador: '7', observacao: undefined },
} as unknown as GuideSnapshotContent;

describe('snapshot da guia (JSON canônico + SHA-256)', () => {
  it('mesma entrada em outra ordem de chaves → mesmos bytes e mesmo hash', () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } });
    const b = canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it('`undefined` some (não vira "null" nem muda o hash)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('serializa, confere e devolve o mesmo conteúdo', () => {
    const { json, sha256 } = serializeGuideSnapshot(content);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/u);
    const back = parseVerifiedGuideSnapshot(json, sha256);
    expect(back.data).toEqual({ registroANS: '123456', numeroGuiaPrestador: '7' });
  });

  it('um byte alterado → recusado (nunca devolvido como guia emitida)', () => {
    const { json, sha256 } = serializeGuideSnapshot(content);
    expect(() => parseVerifiedGuideSnapshot(json.replace('"7"', '"8"'), sha256)).toThrow(
      GuideSnapshotError,
    );
  });

  it('formato desconhecido é recusado mesmo com hash certo', () => {
    const { json, sha256 } = serializeGuideSnapshot({
      ...content,
      schema: 'outro/1',
    } as unknown as GuideSnapshotContent);
    expect(() => parseVerifiedGuideSnapshot(json, sha256)).toThrow(/formato/u);
  });

  it('valores não serializáveis são erro, não perda silenciosa', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(GuideSnapshotError);
    expect(() => canonicalJson({ a: BigInt(1) })).toThrow(GuideSnapshotError);
  });
});
