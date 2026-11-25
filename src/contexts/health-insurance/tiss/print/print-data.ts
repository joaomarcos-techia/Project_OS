/**
 * Dados que SÓ existem no impresso (P7.6/P8.5), congelados no snapshot na emissão.
 *
 * O XML 4.03.00 não tem nome do beneficiário nem nome do contratado executante,
 * mas o modelo impresso os exige (Consulta 7 e 10; SP/SADT 10 e 30). Reconstruir na
 * hora da impressão a partir do cadastro ATUAL seria imprimir outra guia (o paciente
 * pode ter mudado de nome, a clínica de razão social). Por isso eles são lidos na
 * transação da emissão e gravados no snapshot cifrado, ao lado (e fora) do dado do
 * XML: o construtor do XML nunca lê este bloco.
 */

export interface GuidePrintData {
  schema: 'qoro.hi.guide-print/1';
  /** Consulta 7 / SP/SADT 10 — obrigatório no papel. */
  beneficiarioNome: string;
  /** Consulta 26 / SP/SADT 89 — só quando o beneficiário pede; o Qoro não coleta (null). */
  nomeSocial: string | null;
  /** Consulta 10 / SP/SADT 30 — nome do contratado executante. */
  contratadoNome: string;
  /** Área "Logo da Empresa" do modelo: o Qoro imprime o nome da operadora (sem logotipo de terceiro). */
  operadoraNome: string | null;
  /**
   * SP/SADT de cobrança: itens da solicitação vinculada (24–27) e quantidade autorizada
   * pela operadora (28). Sem solicitação vinculada: null, e o bloco fica em branco
   * (nunca se copia o executado como se tivesse sido solicitado).
   */
  solicitados?: ReadonlyArray<{
    codigoTabela: string;
    codigoProcedimento: string;
    descricao: string;
    quantidadeSolicitada: number;
    quantidadeAutorizada: number | null;
  }> | null;
}

export class GuidePrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuidePrintError';
  }
}

const NAME_MAX = 70;

/** Confere o bloco antes de gravar ou imprimir: sem nome inventado, sem campo vazio "preenchido". */
export function assertGuidePrintData(p: unknown): asserts p is GuidePrintData {
  const d = p as Partial<GuidePrintData> | null;
  if (!d || d.schema !== 'qoro.hi.guide-print/1') throw new GuidePrintError('bloco de impressão ausente ou desconhecido');
  for (const [field, value] of [
    ['beneficiarioNome', d.beneficiarioNome],
    ['contratadoNome', d.contratadoNome],
  ] as const) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > NAME_MAX) {
      throw new GuidePrintError(`${field} obrigatório no impresso (1 a ${NAME_MAX} caracteres)`);
    }
  }
  if (d.nomeSocial != null && (typeof d.nomeSocial !== 'string' || d.nomeSocial.trim().length > NAME_MAX)) {
    throw new GuidePrintError(`nomeSocial com mais de ${NAME_MAX} caracteres`);
  }
}
