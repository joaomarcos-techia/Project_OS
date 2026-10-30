/**
 * requireActiveClinic (C13 — ADR-016). Enforcement de acesso APP-LAYER (nunca
 * RLS). Bloqueia mutação de negócio quando a clínica está suspended_readonly /
 * suspended / cancelled / pending_payment. Reutiliza o mesmo gate de escrita
 * do wrapper, inclusive o prazo absoluto do trial versionado.
 *
 * ⚠️ ESTA função é o caminho para quem NÃO passa pelo chokepoint. Desde o
 * ADR-046 o gate roda dentro do `idempotentMutation`
 * ([assertClinicCanWriteTx](../../../lib/tenant-access/index.ts)), então a
 * imensa maioria das mutações é coberta automaticamente. Chamar isto à mão só é
 * necessário nas escritas que não passam pelo wrapper — por exemplo, ações
 * administrativas de equipe.
 *
 * Antes do ADR-046 esta função existia mas era chamada em SETE lugares, TODOS em
 * `equipe/actions.ts`: uma clínica suspensa seguia criando paciente, agendando e
 * escrevendo prontuário. O "somente leitura" era encenação.
 */
import { withTenant } from '@/lib/db/tenant';
import { assertClinicCanWriteTx, ClinicAccessError } from '@/lib/tenant-access';

export { ClinicAccessError };

export async function requireActiveClinic(clinicId: string): Promise<void> {
  await withTenant(clinicId, (tx) => assertClinicCanWriteTx(tx, clinicId));
}
