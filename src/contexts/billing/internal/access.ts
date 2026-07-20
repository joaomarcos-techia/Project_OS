/**
 * Access policy (C13 — ADR-016 Amendment). Separação billing-status (Asaas) vs
 * access-status (ClinicaOS). Este módulo mapeia o MODO DE ACESSO decidido pelo
 * billing para o `clinics.status` (fonte do acesso) e define o que cada status
 * bloqueia. Enforcement é app-layer (nunca RLS — ADR-016).
 */
export type AccessMode = 'enabled' | 'readonly' | 'blocked';

export type ClinicStatus =
  | 'trial'
  | 'active'
  | 'suspended_readonly'
  | 'suspended'
  | 'cancelled'
  | 'pending_payment';

/** Modo de acesso (decisão do dunning) → clinics.status (fonte do acesso). */
export function accessModeToClinicStatus(mode: AccessMode): ClinicStatus {
  switch (mode) {
    case 'enabled':
      return 'active';
    case 'readonly':
      return 'suspended_readonly';
    case 'blocked':
      return 'suspended';
  }
}

/**
 * Escrita (mutação de negócio) bloqueada? (ADR-016)
 *
 * É o ÚNICO enforcement de billing (ADR-046). Inadimplência nunca bloqueia login
 * nem leitura: o prontuário é registro médico-legal com guarda obrigatória de 20
 * anos (CFM 1.821/2007 — ADR-017), e trancar o profissional fora dele por disputa
 * comercial põe o produto entre ele e uma obrigação legal dele.
 *
 * ⚠️ Existia aqui um `isLoginBlocked`, previsto pelo ADR-016 e NUNCA plugado (zero
 * call-sites, só testes). Foi REMOVIDO em 2026-07-20 junto com a emenda do ADR-046
 * — um predicado não usado, descrevendo uma defesa que decidimos não ter, convida
 * alguém a plugá-lo daqui a um ano sem revisitar o porquê.
 *
 * A alavanca de cobrança é esta função: sem escrita, a clínica não opera (não
 * agenda, não atende, não prescreve). Ler o que já é dela, sempre pode.
 */
export function isWriteBlocked(status: ClinicStatus): boolean {
  return (
    status === 'suspended_readonly' ||
    status === 'suspended' ||
    status === 'cancelled' ||
    status === 'pending_payment'
  );
}
