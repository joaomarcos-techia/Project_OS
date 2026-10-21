/**
 * Vagas da equipe para a tela (ADR-067). Puro e sem servidor: a página monta,
 * o drawer de convite consome. A autoridade continua no servidor — checagem
 * barata no convite e trigger de `profiles` (migration 0119).
 */
import { isPractitioner, type PractitionerCandidate } from '@/lib/auth/practitioner';

export type SeatCategory = 'professionals' | 'staff';

export type TeamSeats =
  /** Tabela antiga: teto total de usuários (convite pendente conta). */
  | { model: 'users'; used: number; limit: number | null }
  /** Oferta por profissional: profissionais e equipe administrativa. */
  | {
      model: 'categories';
      professionals: { used: number; limit: number | null };
      staff: { used: number; limit: number | null };
    };

type Member = PractitionerCandidate & { ativo: boolean };

export function teamSeatsFrom(
  limits: { users: number | null; professionals: number | null; staff: number | null } | null,
  members: readonly Member[],
): TeamSeats {
  const active = members.filter((member) => member.ativo && member.role !== 'super_admin');
  if (!limits || limits.users !== null || limits.professionals === null) {
    return {
      model: 'users',
      used: members.filter((member) => member.ativo).length,
      limit: limits?.users ?? null,
    };
  }
  const professionals = active.filter((member) => isPractitioner(member)).length;
  return {
    model: 'categories',
    professionals: { used: professionals, limit: limits.professionals },
    staff: { used: active.length - professionals, limit: limits.staff },
  };
}

function full(slot: { used: number; limit: number | null }): boolean {
  return slot.limit !== null && slot.used >= slot.limit;
}

/** A categoria (ou o total, na tabela antiga) já está cheia? */
export function seatsFull(seats: TeamSeats, category: SeatCategory): boolean {
  return seats.model === 'users' ? full(seats) : full(seats[category]);
}

/** Nenhum convite cabe: total cheio, ou as duas categorias cheias. */
export function noSeatsLeft(seats: TeamSeats): boolean {
  return seats.model === 'users' ? full(seats) : full(seats.professionals) && full(seats.staff);
}

export function seatSummary(seats: TeamSeats): string | null {
  if (seats.model === 'users') {
    return seats.limit === null ? null : `Usuários: ${seats.used} de ${seats.limit}`;
  }
  const { professionals, staff } = seats;
  const prof =
    professionals.limit === null
      ? `Profissionais: ${professionals.used}`
      : `Profissionais: ${professionals.used} de ${professionals.limit}`;
  const team =
    staff.limit === null ? `Equipe: ${staff.used}` : `Equipe: ${staff.used} de ${staff.limit}`;
  return `${prof} · ${team}`;
}

/** Por que o convite não cabe — o que fazer a seguir, por categoria. */
export function seatLimitMessage(dimension: 'users' | SeatCategory, limit: number | null): string {
  if (dimension === 'professionals') {
    return 'Todas as vagas de profissional de saúde do plano estão ocupadas. Inclua profissionais em Configurações › Assinatura, ou desative alguém que não atende mais.';
  }
  if (dimension === 'staff') {
    return 'As vagas de equipe do Consultório estão ocupadas. No plano Clínica a equipe administrativa é ilimitada (Configurações › Assinatura).';
  }
  return limit === null
    ? 'O limite de usuários do plano foi atingido — remova ou desative um usuário para adicionar outro.'
    : `Seu plano permite ${limit} usuário${limit === 1 ? '' : 's'}. Você atingiu o limite — remova ou desative um usuário para adicionar outro.`;
}
