import { describe, expect, it } from 'vitest';

import { centsAt, child, children, readTissXml, textAt, TissXmlReadError } from './reader';

const latin1 = (s: string) => Buffer.from(s, 'latin1');
const doc = (body: string) => latin1(`<?xml version="1.0" encoding="ISO-8859-1"?><ans:a xmlns:ans="x">${body}</ans:a>`);

describe('leitor XML estrito (P9.5)', () => {
  it('lê elementos com prefixo, texto, entidades predefinidas, referências numéricas e CDATA', () => {
    const r = readTissXml(doc('<ans:b>Jo&#227;o &amp; Maria &lt;ok&gt;</ans:b><ans:c><ans:d>1</ans:d><ans:d>2</ans:d></ans:c><ans:e><![CDATA[x<y]]></ans:e><ans:f/>'));
    expect(r.name).toBe('a');
    expect(textAt(r, 'b')).toBe('João & Maria <ok>');
    expect(children(child(r, 'c'), 'd').map((n) => n.text)).toEqual(['1', '2']);
    expect(textAt(r, 'e')).toBe('x<y');
    expect(child(r, 'f')?.children).toEqual([]);
  });

  it('acentos em ISO-8859-1 chegam certos', () => {
    expect(textAt(readTissXml(doc('<ans:b>Médico clínico</ans:b>')), 'b')).toBe('Médico clínico');
  });

  it('recusa DOCTYPE, entidade declarada, entidade desconhecida e instrução de processamento', () => {
    const cases: Array<[string, string]> = [
      ['<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>', 'DTD_FORBIDDEN'],
      ['<?xml version="1.0"?><a>&x;</a>', 'ENTITY_FORBIDDEN'],
      ['<?xml version="1.0"?><a><?php echo 1 ?></a>', 'PI_FORBIDDEN'],
      ['<?xml version="1.0"?><a>a & b</a>', 'BARE_AMPERSAND'],
    ];
    for (const [xml, code] of cases) {
      expect(() => readTissXml(latin1(xml)), code).toThrowError(TissXmlReadError);
      try {
        readTissXml(latin1(xml));
      } catch (e) {
        expect((e as TissXmlReadError).code).toBe(code);
      }
    }
  });

  it('recusa documento malformado, com duas raízes ou aninhado demais', () => {
    expect(() => readTissXml(latin1('<a><b></a>'))).toThrowError(/fechamento|incompleto/u);
    expect(() => readTissXml(latin1('<a/><b/>'))).toThrowError(/raiz/u);
    expect(() => readTissXml(latin1(`${'<x>'.repeat(70)}${'</x>'.repeat(70)}`))).toThrowError(/profundo/u);
  });

  it('valor monetário TISS vira centavos sem erro de ponto flutuante', () => {
    const r = readTissXml(doc('<ans:v>150.10</ans:v><ans:w>0.07</ans:w><ans:x>12</ans:x><ans:y>1,50</ans:y>'));
    expect([centsAt(r, 'v'), centsAt(r, 'w'), centsAt(r, 'x'), centsAt(r, 'y'), centsAt(r, 'z')]).toEqual([15010, 7, 1200, null, null]);
  });
});
