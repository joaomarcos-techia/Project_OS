import { describe, expect, it } from 'vitest';

import { consultaBatch, consultaGuide } from '../corpus/fixtures';
import { buildLoteGuiasMessage } from '../messages/lote-guias';

import { checkTissEncoding } from './encoding-check';
import { verifyEpilogueHash } from './hash-verify';

const built = buildLoteGuiasMessage(
  consultaBatch([consultaGuide(1, { observacao: 'A & B <ok> ção' })]),
);

describe('verifyEpilogueHash', () => {
  it('confere o hash gravado pelo gerador, com entidades escapadas', () => {
    expect(verifyEpilogueHash(built.bytes)).toEqual({
      declared: built.hash,
      computed: built.hash,
      matches: true,
    });
  });

  it('ignora indentação entre elementos (arquivo formatado por terceiros)', () => {
    const pretty = built.xml.replace(/></gu, '>\n    <');
    expect(verifyEpilogueHash(Buffer.from(pretty, 'latin1')).matches).toBe(true);
  });

  it('ignora comentários', () => {
    const commented = built.xml.replace('<ans:cabecalho>', '<!-- gerado --><ans:cabecalho>');
    expect(verifyEpilogueHash(Buffer.from(commented, 'latin1')).matches).toBe(true);
  });

  it('acusa conteúdo alterado depois do hash', () => {
    const changed = built.xml.replace('G0000001', 'G0000002');
    expect(verifyEpilogueHash(Buffer.from(changed, 'latin1')).matches).toBe(false);
  });

  it('sem epílogo: hash declarado nulo e não confere', () => {
    const cut = built.xml.slice(0, built.xml.indexOf('<ans:epilogo>'));
    const r = verifyEpilogueHash(Buffer.from(cut, 'latin1'));
    expect(r.declared).toBeNull();
    expect(r.matches).toBe(false);
  });
});

describe('checkTissEncoding', () => {
  it('aceita o arquivo do gerador (ISO-8859-1 com acentos)', () => {
    expect(checkTissEncoding(built.bytes)).toBeNull();
  });

  it('acusa o mesmo texto gravado em UTF-8', () => {
    expect(checkTissEncoding(Buffer.from(built.xml, 'utf8'))).toBe('utf8_bytes_declared_latin1');
  });

  it('acusa declaração ausente ou diferente de ISO-8859-1', () => {
    expect(checkTissEncoding(Buffer.from('<a/>', 'latin1'))).toBe('declaration_missing');
    expect(
      checkTissEncoding(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><a/>', 'latin1')),
    ).toBe('declaration_not_iso_8859_1');
  });
});
