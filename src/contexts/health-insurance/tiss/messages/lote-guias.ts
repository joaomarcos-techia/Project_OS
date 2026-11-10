/**
 * Mensagem `ENVIO_LOTE_GUIAS` (mensagemTISS → prestadorParaOperadora →
 * loteGuias), Padrão TISS 4.03.00.
 *
 * Regras do XSD aplicadas aqui, antes de qualquer validação externa:
 *  - um lote leva UM tipo de guia (`guiasTISS` é `choice`);
 *  - no máximo 100 guias por lote (`maxOccurs="100"`);
 *  - o hash do epílogo é calculado sobre a própria árvore gerada.
 */
import { consultaGuideElement, type ConsultaGuideData } from '../guides/consulta';
import { tissEpilogueHash } from '../xml/hash';
import { leaf, node, serializeDocument, toLatin1Bytes, type XmlElement } from '../xml/tree';

export const TISS_MAX_GUIDES_PER_BATCH = 100;

export type ProviderIdKind = 'CNPJ' | 'CPF' | 'codigoPrestadorNaOperadora';

export type BatchGuides = { type: 'consulta'; guides: readonly ConsultaGuideData[] };

export interface LoteGuiasInput {
  /** Versão de comunicação (`Padrao`). */
  padrao: '4.03.00';
  /** Sequencial da transação no prestador (até 12). */
  sequencialTransacao: string;
  /** `AAAA-MM-DD` e `HH:MM:SS`, no horário de registro da transação. */
  dataRegistro: string;
  horaRegistro: string;
  origem: { kind: ProviderIdKind; value: string };
  /** Registro ANS da operadora de destino. */
  registroANSDestino: string;
  /** Número do lote no prestador (até 12). */
  numeroLote: string;
  lote: BatchGuides;
}

export class TissBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TissBatchError';
  }
}

export interface BuiltTissMessage {
  /** Texto do XML (já conferido como ISO-8859-1). */
  xml: string;
  /** Bytes ISO-8859-1 para gravar ou enviar. */
  bytes: Buffer;
  /** Hash MD5 do epílogo. */
  hash: string;
}

function guideElements(lote: BatchGuides): XmlElement[] {
  switch (lote.type) {
    case 'consulta':
      return lote.guides.map(consultaGuideElement);
  }
}

export function buildLoteGuiasMessage(input: LoteGuiasInput): BuiltTissMessage {
  const count = input.lote.guides.length;
  if (count === 0) throw new TissBatchError('lote sem guias');
  if (count > TISS_MAX_GUIDES_PER_BATCH) {
    throw new TissBatchError(
      `lote com ${count} guias excede o limite de ${TISS_MAX_GUIDES_PER_BATCH} do Padrão TISS`,
    );
  }

  const body = [
    node('cabecalho', [
      node('identificacaoTransacao', [
        leaf('tipoTransacao', 'ENVIO_LOTE_GUIAS'),
        leaf('sequencialTransacao', input.sequencialTransacao),
        leaf('dataRegistroTransacao', input.dataRegistro),
        leaf('horaRegistroTransacao', input.horaRegistro),
      ]),
      node('origem', [
        node('identificacaoPrestador', [leaf(input.origem.kind, input.origem.value)]),
      ]),
      node('destino', [leaf('registroANS', input.registroANSDestino)]),
      leaf('Padrao', input.padrao),
    ]),
    node('prestadorParaOperadora', [
      node('loteGuias', [
        leaf('numeroLote', input.numeroLote),
        node('guiasTISS', guideElements(input.lote)),
      ]),
    ]),
  ];
  // O hash cobre cabeçalho e corpo; o epílogo entra depois, com ele.
  const hash = tissEpilogueHash(node('mensagemTISS', body));
  const message = node('mensagemTISS', [...body, node('epilogo', [leaf('hash', hash)])]);
  const xml = serializeDocument(message);
  return { xml, bytes: toLatin1Bytes(xml), hash };
}
