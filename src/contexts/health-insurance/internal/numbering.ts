/**
 * Alocação de números TISS (P7.1) dentro da transação de quem cria a guia,
 * o lote, a transação ou o recurso.
 *
 * Invariantes (provadas em `scripts/security/health-insurance-clinic-db.ts`):
 *  - chamar SEMPRE dentro da mesma transação que grava o documento numerado:
 *    se ela for desfeita, o número volta (nunca foi emitido) e não há buraco;
 *    se ela confirmar, o número nunca mais se repete;
 *  - transações concorrentes recebem números distintos (a linha do contador
 *    fica travada até o fim da transação);
 *  - contadores são independentes por clínica, tipo e escopo;
 *  - várias alocações na mesma transação seguem `sortForAllocation`, para não
 *    haver deadlock;
 *  - retentativa: o chamador repete a TRANSAÇÃO inteira (idempotência no nível
 *    do documento, P1.8), nunca só a alocação.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import {
  formatTissNumber,
  sortForAllocation,
  type CounterKind,
  type NumberFormat,
} from '../tiss/numbering';

export interface AllocateArgs {
  clinicId: string;
  kind: CounterKind;
  /** '' = contador da clínica; ex.: id da operadora quando o contrato exige. */
  scopeKey?: string;
  format?: NumberFormat;
}

export async function allocateTissNumber(tx: Tx, args: AllocateArgs): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT public.hi_next_counter(${args.clinicId}::uuid, ${args.kind}, ${args.scopeKey ?? ''}) AS value`,
  )) as unknown as Array<{ value: string | number }>;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('hi_next_counter não devolveu valor');
  return formatTissNumber(args.kind, value, args.format);
}

/** Vários números na mesma transação, na ordem canônica (sem deadlock). */
export async function allocateTissNumbers(
  tx: Tx,
  clinicId: string,
  requests: ReadonlyArray<Omit<AllocateArgs, 'clinicId'>>,
): Promise<Partial<Record<CounterKind, string>>> {
  const out: Partial<Record<CounterKind, string>> = {};
  for (const kind of sortForAllocation(requests.map((r) => r.kind))) {
    const r = requests.find((x) => x.kind === kind)!;
    out[kind] = await allocateTissNumber(tx, { ...r, clinicId });
  }
  return out;
}
