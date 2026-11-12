import { describe, expect, it } from 'vitest';

import { consultaGuide, sadtGuide } from '../corpus/fixtures';
import type { GuideSnapshotContent } from '../guides/snapshot';
import { inMemoryLookup } from '../terminology/lookup';

import { procedureCodesOf, recheckProcedureCodes } from './terminology-recheck';

const consulta = (code: string, date: string): GuideSnapshotContent => {
  const g = consultaGuide(1);
  return {
    schema: 'qoro.hi.guide-snapshot/1',
    guideType: 'consulta',
    tissVersion: '4.03.00',
    terminologyVersion: '202609',
    data: { ...g, atendimento: { ...g.atendimento, dataAtendimento: date, procedimento: { ...g.atendimento.procedimento, codigoTabela: '22', codigoProcedimento: code } } },
  };
};
const tuss = inMemoryLookup('202609', {
  '22': [
    { code: '10101012', term: 'Consulta', startsOn: '2010-01-01', endsOn: null, implantationEndsOn: null },
    { code: '40301010', term: 'Exame encerrado', startsOn: '2010-01-01', endsOn: '2020-12-31', implantationEndsOn: null },
  ],
});

describe('passo 5 da exportação: códigos TUSS na terminologia da emissão', () => {
  it('código vigente passa; inexistente e fora de vigência viram pendência do gestor, sem corrigir nada', () => {
    const uses = procedureCodesOf([consulta('10101012', '2026-11-10'), consulta('99999999', '2026-11-10'), consulta('40301010', '2026-11-10')]);
    const issues = recheckProcedureCodes(uses, () => tuss);
    expect(issues.map((i) => [i.code, i.field, i.owner])).toEqual([
      ['PROCEDURE_CODE_UNKNOWN', 'guias[1].atendimento.procedimento.codigoProcedimento', 'gestor'],
      ['PROCEDURE_CODE_NOT_EFFECTIVE', 'guias[2].atendimento.procedimento.codigoProcedimento', 'gestor'],
    ]);
  });

  it('a vigência é a da data de realização, não a de hoje', () => {
    expect(recheckProcedureCodes(procedureCodesOf([consulta('40301010', '2019-05-02')]), () => tuss)).toEqual([]);
  });

  it('terminologia da emissão ausente é pendência; tabela própria da operadora (não 22) não é conferida na TUSS', () => {
    const missing = recheckProcedureCodes(procedureCodesOf([consulta('10101012', '2026-11-10')]), () => null);
    expect(missing.map((i) => i.code)).toEqual(['TERMINOLOGY_VERSION_MISSING']);
    const own = consulta('ABC123', '2026-11-10');
    if (own.guideType === 'consulta') own.data.atendimento.procedimento.codigoTabela = '00';
    expect(recheckProcedureCodes(procedureCodesOf([own]), () => tuss)).toEqual([]);
  });

  it('SP/SADT: cada procedimento com a sua data de execução', () => {
    const g = sadtGuide(1);
    const content: GuideSnapshotContent = {
      schema: 'qoro.hi.guide-snapshot/1',
      guideType: 'sp_sadt',
      tissVersion: '4.03.00',
      terminologyVersion: '202609',
      data: {
        ...g,
        procedimentos: [
          { ...g.procedimentos[0]!, codigoTabela: '22', codigoProcedimento: '10101012', dataExecucao: '2026-11-10' },
          { ...g.procedimentos[0]!, sequencial: 2, codigoTabela: '22', codigoProcedimento: '40301010', dataExecucao: '2026-11-10' },
        ],
      },
    };
    const issues = recheckProcedureCodes(procedureCodesOf([content]), () => tuss);
    expect(issues.map((i) => [i.code, i.field])).toEqual([['PROCEDURE_CODE_NOT_EFFECTIVE', 'guias[0].procedimentos[1].codigoProcedimento']]);
  });
});
