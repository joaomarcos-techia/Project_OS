/**
 * Rótulo de guia em todas as telas de Convênios (decisão de UX com a repaginação, 14/11):
 *  - forma longa em links, títulos, avisos, ficha, repasses e solicitações:
 *    "Guia de consulta nº 1", "Guia de SP/SADT nº 1";
 *  - forma curta ("nº 1") só onde o tipo já está dito ao lado (coluna "Tipo", lista de um lote
 *    de um tipo só, seção "Guias de consulta aprovadas");
 *  - nunca "Consulta 1" sozinho: na clínica, "consulta" é o atendimento;
 *  - o número aparece sempre como está gravado (zeros à esquerda mantidos).
 */
const TYPE_NAME: Record<string, string> = { consulta: 'consulta', sp_sadt: 'SP/SADT' };

export function guideLabel(
  guideType: string | null | undefined,
  number: string,
  opts: { lowercase?: boolean } = {},
): string {
  const name = guideType ? TYPE_NAME[guideType] : undefined;
  const label = name ? `Guia de ${name} nº ${number}` : `Guia nº ${number}`;
  return opts.lowercase ? `g${label.slice(1)}` : label;
}

export function guideShortLabel(number: string): string {
  return `nº ${number}`;
}
