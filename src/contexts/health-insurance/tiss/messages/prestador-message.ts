/**
 * Mensagem TISS do prestador para a operadora, para os tipos além do lote de guias
 * (P9.1): o MESMO cabeçalho e o MESMO hash de epílogo do `lote-guias.ts`, com o corpo
 * de cada transação. O lote continua no `lote-guias.ts` (já validado no corpus c1).
 */
import { tissEpilogueHash } from '../xml/hash';
import { leaf, node, serializeDocument, toLatin1Bytes, type XmlElement } from '../xml/tree';

import type { BuiltTissMessage, LoteGuiasHeader } from './lote-guias';

export type PrestadorTransaction = 'SOLICITACAO_PROCEDIMENTOS' | 'RECURSO_GLOSA';

export type PrestadorMessageHeader = Omit<LoteGuiasHeader, 'numeroLote'>;

export function assemblePrestadorMessage(
  header: PrestadorMessageHeader,
  tipoTransacao: PrestadorTransaction,
  /** Filho de `prestadorParaOperadora` (ex.: `solicitacaoProcedimento`, `recursoGlosa`). */
  body: XmlElement,
): BuiltTissMessage {
  const content = [
    node('cabecalho', [
      node('identificacaoTransacao', [
        leaf('tipoTransacao', tipoTransacao),
        leaf('sequencialTransacao', header.sequencialTransacao),
        leaf('dataRegistroTransacao', header.dataRegistro),
        leaf('horaRegistroTransacao', header.horaRegistro),
      ]),
      node('origem', [node('identificacaoPrestador', [leaf(header.origem.kind, header.origem.value)])]),
      node('destino', [leaf('registroANS', header.registroANSDestino)]),
      leaf('Padrao', header.padrao),
    ]),
    node('prestadorParaOperadora', [body]),
  ];
  const hash = tissEpilogueHash(node('mensagemTISS', content));
  const message = node('mensagemTISS', [...content, node('epilogo', [leaf('hash', hash)])]);
  const xml = serializeDocument(message);
  return { xml, bytes: toLatin1Bytes(xml), hash };
}
