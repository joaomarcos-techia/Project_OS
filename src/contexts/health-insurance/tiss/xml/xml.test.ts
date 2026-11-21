import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EPILOGUE_ELEMENT, tissEpilogueHash } from './hash';
import {
  TISS_NAMESPACE,
  TissEncodingError,
  leaf,
  leafValuesInOrder,
  node,
  serializeDocument,
  toLatin1Bytes,
} from './tree';

const message = node('mensagemTISS', [
  node('cabecalho', [leaf('tipoTransacao', 'ENVIO_LOTE_GUIAS'), leaf('Padrao', '4.03.00')]),
  node('prestadorParaOperadora', [
    node('loteGuias', [leaf('numeroLote', '12'), leaf('observacao', 'João & Cia <ok>')]),
    leaf('opcional', undefined),
    leaf('vazio', ''),
  ]),
  node(EPILOGUE_ELEMENT, [leaf('hash', 'x'.repeat(32))]),
]);

/**
 * Cálculo INDEPENDENTE do hash, a partir do texto serializado: remove a
 * declaração e o epílogo, apaga as tags, decodifica as entidades e aplica MD5
 * sobre os bytes latin1. Se o gerador e esta leitura do texto discordarem, um
 * dos dois está errado.
 */
function independentHash(xml: string): string {
  const withoutEpilogue = xml
    .replace(/^<\?xml[^>]*\?>/u, '')
    .replace(/<ans:epilogo>[\s\S]*<\/ans:epilogo>/u, '');
  const text = withoutEpilogue
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
  return createHash('md5').update(Buffer.from(text, 'latin1')).digest('hex');
}

describe('árvore XML TISS', () => {
  it('serializa compacto, com namespace TISS e declaração ISO-8859-1', () => {
    const xml = serializeDocument(message);
    expect(xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    expect(xml).toContain(`<ans:mensagemTISS xmlns:ans="${TISS_NAMESPACE}">`);
    expect(xml).not.toMatch(/>\s+</u);
    expect(xml).toContain('<ans:observacao>João &amp; Cia &lt;ok&gt;</ans:observacao>');
  });

  it('não emite opcional ausente nem elemento vazio', () => {
    const xml = serializeDocument(message);
    expect(xml).not.toContain('opcional');
    expect(xml).not.toContain('vazio');
  });

  it('recusa caractere fora do ISO-8859-1, apontando o campo', () => {
    const bad = node('mensagemTISS', [node('dados', [leaf('nome', 'Zoë 😀')])]);
    expect(() => serializeDocument(bad)).toThrow(TissEncodingError);
    expect(() => serializeDocument(bad)).toThrow(/\/mensagemTISS\/dados\/nome.*U\+1F600/u);
  });

  it('bytes em latin1: "ã" vira um byte só (0xE3)', () => {
    const bytes = toLatin1Bytes(serializeDocument(message));
    expect(bytes.includes(Buffer.from([0xe3]))).toBe(true);
    expect(bytes.includes(Buffer.from('ã', 'utf8'))).toBe(false);
  });

  it('valores das folhas em ordem de documento, pulando o epílogo', () => {
    expect(leafValuesInOrder(message, new Set([EPILOGUE_ELEMENT]))).toEqual([
      'ENVIO_LOTE_GUIAS',
      '4.03.00',
      '12',
      'João & Cia <ok>',
    ]);
  });
});

describe('hash do epílogo', () => {
  it('é o MD5 hexadecimal dos valores concatenados em latin1, sem o epílogo', () => {
    const expected = createHash('md5')
      .update(Buffer.from('ENVIO_LOTE_GUIAS4.03.0012João & Cia <ok>', 'latin1'))
      .digest('hex');
    expect(tissEpilogueHash(message)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('confere com o cálculo independente feito sobre o texto serializado', () => {
    expect(tissEpilogueHash(message)).toBe(independentHash(serializeDocument(message)));
  });

  it('muda quando qualquer valor muda, e não depende do valor atual do hash', () => {
    const other = node('mensagemTISS', [
      node('cabecalho', [leaf('tipoTransacao', 'ENVIO_LOTE_GUIAS'), leaf('Padrao', '4.03.00')]),
      node('prestadorParaOperadora', [
        node('loteGuias', [leaf('numeroLote', '13'), leaf('observacao', 'João & Cia <ok>')]),
      ]),
      node(EPILOGUE_ELEMENT, [leaf('hash', 'y'.repeat(32))]),
    ]);
    expect(tissEpilogueHash(other)).not.toBe(tissEpilogueHash(message));
  });
});
