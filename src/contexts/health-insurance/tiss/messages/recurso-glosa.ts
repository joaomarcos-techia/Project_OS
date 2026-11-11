/**
 * Recurso de glosa (P9.7/P9.1): mensagem `RECURSO_GLOSA` com `guiaRecursoGlosa`
 * (`ctm_recursoGlosa`, XSD 4.03.00), na ordem do XSD.
 *
 * Duas formas (`dm_objetoRecurso`): 1 — recurso do PROTOCOLO inteiro (código e
 * justificativa únicos); 2 — recurso por GUIA, da guia completa ou de itens
 * (sequencial, procedimento, código da glosa, valor recursado e justificativa).
 *
 * A justificativa é sempre texto de uma pessoa para ESTE recurso: o Qoro não gera
 * justificativa. Recurso apresentado não é perda nem ganho: o ajuste financeiro só
 * acontece com a glosa DEFINITIVA (P10.3).
 */
import { formatTissMoney, type ContractorIdKind } from '../guides/consulta';
import { leaf, node, type XmlElement } from '../xml/tree';

import type { BuiltTissMessage } from './lote-guias';
import { assemblePrestadorMessage, type PrestadorMessageHeader } from './prestador-message';

export interface AppealItem {
  sequencialItem: number;
  dataInicio: string;
  dataFim?: string | null;
  codigoTabela: string;
  codigoProcedimento: string;
  descricao: string;
  grauParticipacao?: string | null;
  /** Código da glosa (tabela 38 / `dm_tipoGlosa`). */
  codigoGlosa: string;
  valorRecursadoCentavos: number;
  justificativa: string;
}

export interface AppealGuide {
  numeroGuiaOrigem: string;
  numeroGuiaOperadora?: string | null;
  senha?: string | null;
  /** Guia completa: um ou mais códigos com justificativa; ou itens. */
  guiaCompleta?: ReadonlyArray<{ codigoGlosa: string; justificativa: string }> | null;
  itens?: readonly AppealItem[] | null;
}

export interface GlossAppealData {
  registroANS: string;
  /** Número do recurso no prestador (até 20). */
  numeroGuiaRecGlosaPrestador: string;
  nomeOperadora: string;
  /** 1 — protocolo; 2 — guia. */
  objetoRecurso: '1' | '2';
  numeroGuiaRecGlosaOperadora?: string | null;
  /** `ct_contratadoDados`: só o identificador (o nome saiu na versão 4.00.00). */
  contratado: { kind: ContractorIdKind; value: string };
  numeroLote: string;
  /** `st_numerico12`: o protocolo devolvido pela operadora no envio do lote. */
  numeroProtocolo: string;
  recursoProtocolo?: { codigoGlosa: string; justificativa: string } | null;
  guias?: readonly AppealGuide[] | null;
  /** Total recursado (centavos). Por item: a soma dos itens. */
  valorTotalRecursadoCentavos: number;
  /** `AAAA-MM-DD`. */
  dataRecurso: string;
}

function guideElement(g: AppealGuide): XmlElement {
  return node('recursoGuia', [
    leaf('numeroGuiaOrigem', g.numeroGuiaOrigem),
    leaf('numeroGuiaOperadora', g.numeroGuiaOperadora),
    leaf('senha', g.senha),
    node('opcaoRecursoGuia', [
      ...(g.guiaCompleta ?? []).map((c) =>
        node('recursoGuiaCompleta', [leaf('codGlosaGuia', c.codigoGlosa), leaf('justificativaGuia', c.justificativa)]),
      ),
      ...(g.itens ?? []).map((i) =>
        node('itensGuia', [
          leaf('sequencialItem', i.sequencialItem),
          leaf('dataInicio', i.dataInicio),
          leaf('dataFim', i.dataFim),
          node('procRecurso', [
            leaf('codigoTabela', i.codigoTabela),
            leaf('codigoProcedimento', i.codigoProcedimento),
            leaf('descricaoProcedimento', i.descricao),
          ]),
          leaf('grauParticipacao', i.grauParticipacao),
          leaf('codGlosaItem', i.codigoGlosa),
          leaf('valorRecursado', formatTissMoney(i.valorRecursadoCentavos)),
          leaf('justificativaItem', i.justificativa),
        ]),
      ),
    ]),
  ]);
}

export function glossAppealElement(d: GlossAppealData): XmlElement {
  return node('guiaRecursoGlosa', [
    leaf('registroANS', d.registroANS),
    leaf('numeroGuiaRecGlosaPrestador', d.numeroGuiaRecGlosaPrestador),
    leaf('nomeOperadora', d.nomeOperadora),
    leaf('objetoRecurso', d.objetoRecurso),
    leaf('numeroGuiaRecGlosaOperadora', d.numeroGuiaRecGlosaOperadora),
    node('dadosContratado', [leaf(d.contratado.kind, d.contratado.value)]),
    leaf('numeroLote', d.numeroLote),
    leaf('numeroProtocolo', d.numeroProtocolo),
    node('opcaoRecurso', [
      d.recursoProtocolo
        ? node('recursoProtocolo', [
            leaf('codigoGlosaProtocolo', d.recursoProtocolo.codigoGlosa),
            leaf('justificativaProtocolo', d.recursoProtocolo.justificativa),
          ])
        : null,
      ...(d.guias ?? []).map(guideElement),
    ]),
    leaf('valorTotalRecursado', formatTissMoney(d.valorTotalRecursadoCentavos)),
    leaf('dataRecurso', d.dataRecurso),
  ]);
}

export function buildRecursoGlosaMessage(header: PrestadorMessageHeader, appeal: GlossAppealData): BuiltTissMessage {
  return assemblePrestadorMessage(header, 'RECURSO_GLOSA', node('recursoGlosa', [glossAppealElement(appeal)]));
}
