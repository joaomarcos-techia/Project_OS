import { describe, expect, it } from 'vitest';

import { verifyEpilogueHash } from '../xml/hash-verify';

import { TissCancellationError, buildCancelaGuiaMessage } from './cancela-guia';

// Dados 100% fictícios.
const header = {
  padrao: '4.03.00' as const,
  sequencialTransacao: '123',
  dataRegistro: '2026-11-16',
  horaRegistro: '10:00:00',
  origem: { kind: 'codigoPrestadorNaOperadora' as const, value: 'TESTE001' },
  registroANSDestino: '123456',
};
const data = {
  contratado: { kind: 'codigoPrestadorNaOperadora' as const, value: 'TESTE001' },
  guias: [{ tipoGuia: '2' as const, numeroGuiaPrestador: '0000123', numeroProtocolo: '987654' }],
};

describe('cancelaGuia (P7.5, XSD 4.03.00 ct_guiaCancelamento)', () => {
  it('monta a transação CANCELA_GUIA com o corpo na ordem do XSD e o hash do epílogo conferível', () => {
    const m = buildCancelaGuiaMessage(header, data);
    expect(m.xml).toContain('<ans:tipoTransacao>CANCELA_GUIA</ans:tipoTransacao>');
    const body = m.xml.slice(m.xml.indexOf('<ans:cancelaGuia>'), m.xml.indexOf('</ans:cancelaGuia>'));
    const order = ['dadosPrestador', 'tipoCancelamento', 'tipoCancelamentoGuia', 'tipoGuia', 'numeroGuiaPrestador', 'numeroProtocolo'];
    const positions = order.map((t) => body.indexOf(`<ans:${t}>`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Campo opcional ausente não vira elemento vazio.
    expect(body).not.toContain('numeroGuiaOperadora');
    const h = verifyEpilogueHash(m.bytes);
    expect([h.matches, h.computed]).toEqual([true, m.hash]);
  });

  it('várias guias no mesmo pedido: um tipoCancelamentoGuia por guia', () => {
    const m = buildCancelaGuiaMessage(header, { ...data, guias: [data.guias[0]!, { tipoGuia: '2', numeroGuiaPrestador: '0000124', numeroGuiaOperadora: 'OP-1' }] });
    expect(m.xml.match(/<ans:tipoCancelamentoGuia>/gu)?.length).toBe(2);
    expect(m.xml).toContain('<ans:numeroGuiaOperadora>OP-1</ans:numeroGuiaOperadora>');
  });

  it('recusa pedido vazio e campos acima dos limites do XSD (st_texto20, st_texto12)', () => {
    expect(() => buildCancelaGuiaMessage(header, { ...data, guias: [] })).toThrow(TissCancellationError);
    expect(() => buildCancelaGuiaMessage(header, { ...data, guias: [{ tipoGuia: '2', numeroGuiaPrestador: 'x'.repeat(21) }] })).toThrow(/20 caracteres/u);
    expect(() => buildCancelaGuiaMessage(header, { ...data, guias: [{ tipoGuia: '2', numeroGuiaPrestador: '1', numeroProtocolo: '1'.repeat(13) }] })).toThrow(/12 caracteres/u);
  });
});
