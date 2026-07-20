/**
 * Access policy (C13 — ADR-016 Amendment). Separação billing-status (Asaas) vs
 * access-status (ClinicaOS). Este módulo mapeia o MODO DE ACESSO decidido pelo
 * billing para o `clinics.status` (fonte do acesso). Enforcement é app-layer
 * (nunca RLS — ADR-016).
 *
 * ⚠️ A PRIMITIVA (`isWriteBlocked`, `ClinicStatus`) mudou de casa em 2026-07-20:
 * mora em [@/lib/tenant-access](../../../lib/tenant-access/index.ts) e é
 * re-exportada aqui para manter uma única fonte da verdade.
 *
 * POR QUÊ: o gate de escrita passou a ser aplicado no CHOKEPOINT de mutação
 * (`idempotentMutation`, ADR-046) — antes ele existia mas era chamado em 7
 * lugares, todos em `equipe/actions.ts`, e uma clínica suspensa seguia criando
 * paciente e prontuário. O chokepoint é `lib`, e a matriz de imports proíbe
 * `lib → context` (com razão: infra não depende de domínio). A separação:
 *
 *   - plataforma (`lib/tenant-access`): a PRIMITIVA — dado um status, pode escrever?
 *   - billing (aqui): a DECISÃO — qual status o dunning escolhe.
 *
 * ⚠️ Existia aqui um `isLoginBlocked`, previsto pelo ADR-016 e NUNCA plugado
 * (zero call-sites, só testes). REMOVIDO junto com a emenda do ADR-046 — um
 * predicado não usado, descrevendo uma defesa que decidimos não ter, convida
 * alguém a plugá-lo daqui a um ano sem revisitar o porquê.
 */
export { isWriteBlocked, type ClinicStatus } from '@/lib/tenant-access';

export type AccessMode = 'enabled' | 'readonly' | 'blocked';

/** Modo de acesso (decisão do dunning) → clinics.status (fonte do acesso). */
export function accessModeToClinicStatus(
  mode: AccessMode,
): 'active' | 'suspended_readonly' | 'suspended' {
  switch (mode) {
    case 'enabled':
      return 'active';
    case 'readonly':
      return 'suspended_readonly';
    case 'blocked':
      return 'suspended';
  }
}
