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

/** Escrita (mutação de negócio) bloqueada? (ADR-016) */
export function isWriteBlocked(status: ClinicStatus): boolean {
  return (
    status === 'suspended_readonly' ||
    status === 'suspended' ||
    status === 'cancelled' ||
    status === 'pending_payment'
  );
}

/** Login bloqueado? (exceto owner para regularizar — tratado no call-site) */
export function isLoginBlocked(status: ClinicStatus): boolean {
  return status === 'suspended' || status === 'cancelled' || status === 'pending_payment';
}
