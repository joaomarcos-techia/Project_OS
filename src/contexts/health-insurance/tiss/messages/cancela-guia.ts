/**
 * Pedido de cancelamento de guia (P7.5): mensagem `CANCELA_GUIA` com `cancelaGuia`
 * (`ct_guiaCancelamento`, XSD 4.03.00), na ordem do XSD:
 *
 *   dadosPrestador (ct_contratadoDados) → tipoCancelamento → tipoCancelamentoGuia (1..n):
 *     tipoGuia (dm_tipoGuia: 2 = faturamento) → numeroGuiaPrestador (st_texto20)
 *     → numeroGuiaOperadora? (st_texto20) → numeroProtocolo? (st_texto12)
 *
 * O Qoro gera e valida o XML; o ENVIO eletrônico (cancelaGuiaWS) é a P6.5, sem operadora
 * homologada. A resposta da operadora (`reciboCancelaGuia`, `dm_statusCancelamento` = Tabela 46)
 * é registrada como recibo, nunca presumida.
 */
import type { ContractorIdKind } from '../guides/consulta';
import { leaf, node } from '../xml/tree';

import type { BuiltTissMessage } from './lote-guias';
import { assemblePrestadorMessage, type PrestadorMessageHeader } from './prestador-message';

export interface GuideToCancel {
  /** `dm_tipoGuia`: 1 solicitação, 2 faturamento, 3 recurso de glosa. */
  tipoGuia: '1' | '2' | '3';
  numeroGuiaPrestador: string;
  numeroGuiaOperadora?: string | null;
  numeroProtocolo?: string | null;
}

export interface GuideCancellationData {
  contratado: { kind: ContractorIdKind; value: string };
  guias: readonly GuideToCancel[];
}

export class TissCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TissCancellationError';
  }
}

export function buildCancelaGuiaMessage(header: PrestadorMessageHeader, data: GuideCancellationData): BuiltTissMessage {
  if (data.guias.length === 0) throw new TissCancellationError('informe ao menos uma guia a cancelar');
  for (const g of data.guias) {
    if (!g.numeroGuiaPrestador || g.numeroGuiaPrestador.length > 20)
      throw new TissCancellationError('número da guia no prestador ausente ou acima de 20 caracteres');
    if (g.numeroGuiaOperadora && g.numeroGuiaOperadora.length > 20)
      throw new TissCancellationError('número da guia na operadora acima de 20 caracteres');
    if (g.numeroProtocolo && g.numeroProtocolo.length > 12)
      throw new TissCancellationError('protocolo acima de 12 caracteres');
  }
  const body = node('cancelaGuia', [
    node('dadosPrestador', [leaf(data.contratado.kind, data.contratado.value)]),
    node(
      'tipoCancelamento',
      data.guias.map((g) =>
        node('tipoCancelamentoGuia', [
          leaf('tipoGuia', g.tipoGuia),
          leaf('numeroGuiaPrestador', g.numeroGuiaPrestador),
          leaf('numeroGuiaOperadora', g.numeroGuiaOperadora),
          leaf('numeroProtocolo', g.numeroProtocolo),
        ]),
      ),
    ),
  ]);
  return assemblePrestadorMessage(header, 'CANCELA_GUIA', body);
}
