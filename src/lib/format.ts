/**
 * Formatação compartilhada de UI. Dinheiro trafega como `number` (numeric(12,2)
 * no banco → Number() na borda) e é exibido em BRL pt-BR.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata um valor numérico em Real (R$ 1.234,56). */
export function formatBRL(value: number): string {
  return BRL.format(Number.isFinite(value) ? value : 0);
}

/**
 * Mascara um telefone preservando prefixo (país/DDD) + últimos 4 dígitos:
 * `+5511999991234` → `+5511*****1234`. Usado em UI e em payload de auditoria
 * (nunca expor o número completo no log). Entrada não-numérica → `****`.
 */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const last4 = digits.slice(-4);
  const prefix = digits.slice(0, Math.min(4, Math.max(0, digits.length - 4)));
  const stars = '*'.repeat(Math.max(1, digits.length - prefix.length - 4));
  return `+${prefix}${stars}${last4}`;
}

/**
 * REDIGE um CPF, preservando os 6 primeiros e os 2 últimos dígitos:
 * `41290871104` → `412.908.***-04`. É o formato da referência de setembro/2026.
 *
 * Nome diferente de `maskCpf` (lib/masks) de propósito: aquele é FORMATADOR de
 * input, que completa a pontuação enquanto se digita e devolve o CPF inteiro.
 * Este REMOVE dígitos e não tem volta — trocar um pelo outro num campo de
 * formulário salvaria um CPF com asteriscos.
 *
 * Redigir é responsabilidade de QUEM DECIFRA, no servidor: o valor completo
 * nunca deve atravessar a fronteira para o cliente só para a UI escondê-lo.
 * Entrada que não tem 11 dígitos devolve string vazia — CPF inválido não é
 * exibido pela metade.
 */
export function redactCpf(cpf: string | null | undefined): string {
  const digits = (cpf ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return '';
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.***-${digits.slice(9)}`;
}

const QORO_DATE_TIME_ZONE = 'America/Sao_Paulo';

const DATE_PT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: QORO_DATE_TIME_ZONE,
});

/** Formata 'YYYY-MM-DD' ou ISO como dd/mm/aaaa (sem timezone shift para date puro). */
export function formatDatePt(value: string | null | undefined): string {
  if (!value) return '—';
  // 'YYYY-MM-DD' puro: monta como data local sem deslocar o dia.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATE_PT.format(d);
}
