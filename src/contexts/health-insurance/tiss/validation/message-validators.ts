/**
 * Validação semântica da solicitação de procedimento SP/SADT e do recurso de glosa
 * (camada 2 da C.13). Mesmo contrato dos validadores de guia: pendência legível
 * com responsável, nunca exceção, nunca valor inventado. O XSD (camada 1) roda à
 * parte; aqui ficam as regras que o XSD não vê.
 */
import type { GlossAppealData } from '../messages/recurso-glosa';
import type { SpSadtRequestData } from '../messages/solicitacao-procedimento';
import type { TerminologyLookup } from '../terminology/lookup';

import { IssueCollector, hasNonLatin1, isRealDate, lengthBetween, type GuideIssue } from './common';

const CARD = /^[0-9A-Za-z]{1,20}$/u;
const ANS = /^\d{6}$/u;
const NUM12 = /^\d{1,12}$/u;
const TEXT20 = /^[^\s].{0,19}$/u;

function noLatin1Issue(c: IssueCollector, field: string, value: string | null | undefined): void {
  if (hasNonLatin1(value)) {
    c.add('NON_LATIN1', field, 'Há caractere que o padrão TISS (ISO-8859-1) não aceita. Troque-o.', 'recepcao');
  }
}

export function validateSpSadtRequest(
  d: SpSadtRequestData,
  ctx: { terminology: TerminologyLookup; today: string },
): GuideIssue[] {
  const c = new IssueCollector(ctx.terminology);
  if (!ANS.test(d.registroANS)) c.add('ANS_INVALID', 'registroANS', 'Registro ANS da operadora inválido (6 dígitos).', 'gestor');
  if (!TEXT20.test(d.numeroGuiaPrestador)) {
    c.add('REQUEST_NUMBER_INVALID', 'numeroGuiaPrestador', 'Número da solicitação no prestador ausente ou com mais de 20 caracteres.', 'gestor');
  }
  if (!CARD.test(d.beneficiario.numeroCarteira)) {
    c.add('CARD_INVALID', 'beneficiario.numeroCarteira', 'Número da carteirinha ausente ou inválido.', 'recepcao');
  }
  const p = d.solicitante.profissional;
  if (!c.inTable('26', p.conselho)) c.add('COUNCIL_INVALID', 'solicitante.conselho', 'Conselho profissional fora da tabela 26.', 'gestor');
  if (!c.inTable('59', p.uf)) c.add('UF_INVALID', 'solicitante.uf', 'UF do conselho fora da tabela 59.', 'gestor');
  if (!c.inTable('24', p.cbo)) c.add('CBO_INVALID', 'solicitante.cbo', 'CBO do solicitante fora da tabela 24.', 'gestor');
  if (!lengthBetween(d.solicitante.nomeContratado, 1, 70)) {
    c.add('REQUESTER_NAME_INVALID', 'solicitante.nomeContratado', 'Nome do contratado solicitante ausente ou com mais de 70 caracteres.', 'gestor');
  }
  if (!c.inTable('23', d.caraterAtendimento)) {
    c.add('CARATER_INVALID', 'caraterAtendimento', 'Caráter do atendimento fora da tabela 23.', 'recepcao');
  }
  if (!isRealDate(d.dataSolicitacao) || d.dataSolicitacao > ctx.today) {
    c.add('REQUEST_DATE_INVALID', 'dataSolicitacao', 'Data da solicitação inválida ou no futuro.', 'recepcao');
  }
  // Indicação clínica: só a que o profissional escreveu; nunca preenchida pelo sistema.
  if (d.indicacaoClinica != null && !lengthBetween(d.indicacaoClinica.trim(), 1, 500)) {
    c.add('CLINICAL_INDICATION_INVALID', 'indicacaoClinica', 'Indicação clínica vazia ou com mais de 500 caracteres.', 'medico');
  }
  if (d.procedimentos.length === 0) {
    c.add('NO_PROCEDURE', 'procedimentos', 'A solicitação precisa de ao menos um procedimento.', 'recepcao');
  }
  const seen = new Set<string>();
  d.procedimentos.forEach((proc, i) => {
    const base = `procedimentos[${i}]`;
    if (!c.inTable('87', proc.codigoTabela)) c.add('TABLE_INVALID', `${base}.codigoTabela`, 'Tabela do procedimento fora da tabela 87.', 'gestor');
    if (proc.codigoTabela === '22' && !c.inTable('22', proc.codigoProcedimento)) {
      c.add('TUSS_UNKNOWN', `${base}.codigoProcedimento`, 'Código TUSS inexistente na terminologia vigente.', 'gestor');
    }
    if (!Number.isInteger(proc.quantidade) || proc.quantidade < 1 || proc.quantidade > 999) {
      c.add('QUANTITY_INVALID', `${base}.quantidade`, 'Quantidade solicitada deve ser de 1 a 999.', 'recepcao');
    }
    const key = `${proc.codigoTabela}:${proc.codigoProcedimento}`;
    if (seen.has(key)) c.add('PROCEDURE_DUPLICATED', base, 'O mesmo procedimento aparece duas vezes; some as quantidades.', 'recepcao');
    seen.add(key);
    noLatin1Issue(c, `${base}.descricao`, proc.descricao);
  });
  noLatin1Issue(c, 'indicacaoClinica', d.indicacaoClinica);
  noLatin1Issue(c, 'observacao', d.observacao);
  return c.issues;
}

export function validateGlossAppeal(
  d: GlossAppealData,
  ctx: { terminology: TerminologyLookup; today: string },
): GuideIssue[] {
  const c = new IssueCollector(ctx.terminology);
  if (!ANS.test(d.registroANS)) c.add('ANS_INVALID', 'registroANS', 'Registro ANS da operadora inválido (6 dígitos).', 'gestor');
  if (!TEXT20.test(d.numeroGuiaRecGlosaPrestador)) {
    c.add('APPEAL_NUMBER_INVALID', 'numeroGuiaRecGlosaPrestador', 'Número do recurso no prestador ausente ou com mais de 20 caracteres.', 'financeiro');
  }
  if (!NUM12.test(d.numeroLote)) c.add('BATCH_NUMBER_INVALID', 'numeroLote', 'Número do lote ausente ou inválido.', 'financeiro');
  if (!NUM12.test(d.numeroProtocolo)) {
    c.add(
      'PROTOCOL_NOT_NUMERIC',
      'numeroProtocolo',
      'O recurso exige o protocolo numérico (até 12 dígitos) que a operadora devolveu no envio do lote.',
      'financeiro',
    );
  }
  if (!isRealDate(d.dataRecurso) || d.dataRecurso > ctx.today) {
    c.add('APPEAL_DATE_INVALID', 'dataRecurso', 'Data do recurso inválida ou no futuro.', 'financeiro');
  }
  const justification = (field: string, text: string | null | undefined) => {
    if (!lengthBetween(text?.trim(), 10, 500)) {
      c.add('JUSTIFICATION_INVALID', field, 'A justificativa é escrita por quem recorre, com 10 a 500 caracteres.', 'financeiro');
    }
    noLatin1Issue(c, field, text);
  };
  const glossCode = (field: string, code: string) => {
    if (!c.inTable('38', code)) c.add('GLOSS_CODE_UNKNOWN', field, 'Código de glosa fora da tabela 38.', 'financeiro');
  };

  if (d.objetoRecurso === '1') {
    if (!d.recursoProtocolo || (d.guias?.length ?? 0) > 0) {
      c.add('APPEAL_SHAPE_INVALID', 'opcaoRecurso', 'Recurso de protocolo: um código e uma justificativa, sem guias.', 'financeiro');
    } else {
      glossCode('recursoProtocolo.codigoGlosa', d.recursoProtocolo.codigoGlosa);
      justification('recursoProtocolo.justificativa', d.recursoProtocolo.justificativa);
    }
    if (!(d.valorTotalRecursadoCentavos > 0)) {
      c.add('APPEAL_TOTAL_INVALID', 'valorTotalRecursado', 'Informe o valor total recursado.', 'financeiro');
    }
  } else {
    const guides = d.guias ?? [];
    if (d.recursoProtocolo || guides.length === 0 || guides.length > 100) {
      c.add('APPEAL_SHAPE_INVALID', 'opcaoRecurso', 'Recurso por guia: de 1 a 100 guias, sem recurso de protocolo.', 'financeiro');
    }
    let itemsTotal = 0;
    let hasItems = false;
    guides.forEach((g, gi) => {
      const base = `guias[${gi}]`;
      if (!TEXT20.test(g.numeroGuiaOrigem)) c.add('ORIGIN_GUIDE_INVALID', `${base}.numeroGuiaOrigem`, 'Número da guia de origem ausente.', 'financeiro');
      const full = g.guiaCompleta ?? [];
      const items = g.itens ?? [];
      if ((full.length > 0) === (items.length > 0)) {
        c.add('APPEAL_GUIDE_SHAPE', base, 'Cada guia recorre inteira (código e justificativa) ou por itens, não os dois.', 'financeiro');
      }
      full.forEach((f, fi) => {
        glossCode(`${base}.guiaCompleta[${fi}].codigoGlosa`, f.codigoGlosa);
        justification(`${base}.guiaCompleta[${fi}].justificativa`, f.justificativa);
      });
      items.forEach((it, ii) => {
        hasItems = true;
        const ib = `${base}.itens[${ii}]`;
        glossCode(`${ib}.codigoGlosa`, it.codigoGlosa);
        justification(`${ib}.justificativa`, it.justificativa);
        if (!isRealDate(it.dataInicio)) c.add('ITEM_DATE_INVALID', `${ib}.dataInicio`, 'Data do item inválida.', 'financeiro');
        if (!Number.isInteger(it.valorRecursadoCentavos) || it.valorRecursadoCentavos <= 0) {
          c.add('ITEM_VALUE_INVALID', `${ib}.valorRecursado`, 'O valor recursado do item deve ser maior que zero.', 'financeiro');
        }
        itemsTotal += it.valorRecursadoCentavos;
      });
    });
    if (hasItems && itemsTotal !== d.valorTotalRecursadoCentavos) {
      c.add('APPEAL_TOTAL_MISMATCH', 'valorTotalRecursado', 'O total recursado deve ser a soma dos itens recorridos.', 'financeiro');
    }
  }
  return c.issues;
}
