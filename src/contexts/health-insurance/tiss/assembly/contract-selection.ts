/**
 * Escolha do item de contrato vigente (P7.2/P8.2).
 *
 * A tabela de contratos é append-only (0144): uma correção é uma nova linha
 * com `supersedesId` apontando para a anterior. O item vigente para um
 * procedimento numa data é:
 *  1. da operadora certa, com o código (tabela + procedimento) certo;
 *  2. vigente na data (`validFrom <= data <= validUntil`);
 *  3. não substituído por outra linha;
 *  4. específico do plano, quando existir; senão o geral (`planId` nulo).
 * Empate (duas linhas vigentes e ativas para o mesmo alvo) é ambiguidade de
 * cadastro: devolvido como tal, nunca resolvido em silêncio.
 */
export interface ContractLine {
  id: string;
  insurerId: string;
  planId: string | null;
  guideType: 'consulta' | 'sp_sadt';
  tableCode: string;
  procedureCode: string;
  description: string;
  unitValueCents: number;
  validFrom: string;
  validUntil: string | null;
  requiresAuthorization: boolean;
  copayKind: 'none' | 'fixed' | 'percentage';
  copayFixedCents: number | null;
  /** `numeric(5,2)` vem como texto do driver. */
  copayPercentage: string | number | null;
  returnDays: number | null;
  returnBillable: boolean;
  supersedesId: string | null;
}

export interface ContractQuery {
  insurerId: string;
  planId: string | null;
  guideType: 'consulta' | 'sp_sadt';
  tableCode: string;
  procedureCode: string;
  /** `AAAA-MM-DD` do atendimento. */
  date: string;
}

export type ContractSelection =
  | { kind: 'found'; line: ContractLine }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; lineIds: string[] };

export function selectEffectiveContract(
  lines: readonly ContractLine[],
  q: ContractQuery,
): ContractSelection {
  const superseded = new Set(lines.flatMap((l) => (l.supersedesId ? [l.supersedesId] : [])));
  const candidates = lines.filter(
    (l) =>
      l.insurerId === q.insurerId &&
      l.guideType === q.guideType &&
      l.tableCode === q.tableCode &&
      l.procedureCode === q.procedureCode &&
      l.validFrom <= q.date &&
      (l.validUntil === null || q.date <= l.validUntil) &&
      !superseded.has(l.id) &&
      (l.planId === null || l.planId === q.planId),
  );
  const specific = candidates.filter((l) => l.planId !== null);
  const pool = specific.length > 0 ? specific : candidates;
  if (pool.length === 0) return { kind: 'not_found' };
  if (pool.length > 1) return { kind: 'ambiguous', lineIds: pool.map((l) => l.id).sort() };
  return { kind: 'found', line: pool[0]! };
}
