/**
 * Passo 5 da exportação (P9.2): os códigos TUSS de procedimento das guias que entram no
 * lote são conferidos de novo na terminologia em que cada guia foi emitida, na data em
 * que o procedimento foi realizado. A emissão já conferiu; aqui a conferência é repetida
 * sobre o SNAPSHOT que vai virar XML, para que nenhum código inexistente ou fora de
 * vigência saia num lote faturável, mesmo que a guia tenha vindo de outro caminho.
 *
 * Função pura: quem chama carrega a terminologia (só a tabela 22 e os códigos usados).
 * Nada é corrigido: o problema vira pendência para o gestor.
 */
import type { GuideSnapshotContent } from '../guides/snapshot';
import { isTermEffectiveOn, type TerminologyLookup } from '../terminology/lookup';

import type { GuideIssue } from './common';

export interface ProcedureCodeUse {
  guide: number;
  field: string;
  table: string;
  code: string;
  date: string;
  terminologyVersion: string;
}

/** Os códigos de procedimento de cada guia, com a data de realização e a versão da terminologia. */
export function procedureCodesOf(contents: readonly GuideSnapshotContent[]): ProcedureCodeUse[] {
  const uses: ProcedureCodeUse[] = [];
  contents.forEach((c, guide) => {
    if (c.guideType === 'consulta') {
      const p = c.data.atendimento.procedimento;
      uses.push({
        guide,
        field: `guias[${guide}].atendimento.procedimento.codigoProcedimento`,
        table: p.codigoTabela,
        code: p.codigoProcedimento,
        date: c.data.atendimento.dataAtendimento,
        terminologyVersion: c.terminologyVersion,
      });
    } else {
      c.data.procedimentos.forEach((p, i) =>
        uses.push({
          guide,
          field: `guias[${guide}].procedimentos[${i}].codigoProcedimento`,
          table: p.codigoTabela,
          code: p.codigoProcedimento,
          date: p.dataExecucao,
          terminologyVersion: c.terminologyVersion,
        }),
      );
    }
  });
  return uses;
}

/**
 * Pendências dos códigos TUSS (tabela 22). Códigos de outras tabelas de referência (ex.:
 * 00, tabela própria da operadora) não estão na TUSS e seguem as regras do contrato.
 */
export function recheckProcedureCodes(
  uses: readonly ProcedureCodeUse[],
  lookupFor: (terminologyVersion: string) => TerminologyLookup | null,
): GuideIssue[] {
  const issues: GuideIssue[] = [];
  for (const u of uses) {
    if (u.table !== '22') continue;
    const lookup = lookupFor(u.terminologyVersion);
    if (!lookup) {
      issues.push({
        code: 'TERMINOLOGY_VERSION_MISSING',
        field: u.field,
        message: `A terminologia ${u.terminologyVersion}, em que a guia foi emitida, não está carregada no Qoro.`,
        owner: 'gestor',
      });
      continue;
    }
    const term = lookup.term('22', u.code);
    if (!term) {
      issues.push({
        code: 'PROCEDURE_CODE_UNKNOWN',
        field: u.field,
        message: `O código ${u.code} não existe na TUSS 22 (${lookup.version}).`,
        owner: 'gestor',
      });
    } else if (!isTermEffectiveOn(term, u.date)) {
      issues.push({
        code: 'PROCEDURE_CODE_NOT_EFFECTIVE',
        field: u.field,
        message: `O código ${u.code} não estava vigente na data de realização (${u.date}).`,
        owner: 'gestor',
      });
    }
  }
  return issues;
}
