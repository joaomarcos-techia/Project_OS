/**
 * P6.1 — regras puras da autorização da operadora (C.8), sem banco:
 *   - transições permitidas (o banco confere a evidência pelo CHECK `hi_authorizations_evidence_chk`);
 *   - estado mostrado: "consumida" e "vencida" são derivados (o banco não tem status "consumida", e
 *     a senha vencida aparece como vencida mesmo antes da rotina que grava o vencimento);
 *   - comprovante: tipo conferido pelos primeiros bytes (não pelo nome nem pelo tipo declarado) e
 *     tamanho, nos mesmos limites do banco (0146).
 */

export const AUTHORIZATION_STATUSES = [
  'draft',
  'requested',
  'pending_operator',
  'authorized',
  'partially_authorized',
  'denied',
  'expired',
  'cancelled',
] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/** Concedida pela operadora (número, senha ou protocolo registrados por alguém, ou recibo do conector). */
export const GRANTED_AUTHORIZATION: readonly AuthorizationStatus[] = ['authorized', 'partially_authorized'];

const NEXT: Readonly<Record<AuthorizationStatus, readonly AuthorizationStatus[]>> = {
  draft: ['requested', 'cancelled'],
  requested: ['pending_operator', 'authorized', 'partially_authorized', 'denied', 'cancelled'],
  pending_operator: ['authorized', 'partially_authorized', 'denied', 'cancelled'],
  // Concedida: só vence (senha) ou é cancelada. Nunca volta a "pedida" nem vira negada.
  authorized: ['expired', 'cancelled'],
  partially_authorized: ['expired', 'cancelled'],
  denied: [],
  expired: [],
  cancelled: [],
};

export function canTransitionAuthorization(from: AuthorizationStatus, to: AuthorizationStatus): boolean {
  return NEXT[from].includes(to);
}

export type AuthorizationDisplayState = AuthorizationStatus | 'consumed';

export interface AuthorizationForDisplay {
  status: AuthorizationStatus;
  /** AAAA-MM-DD, ou nulo quando a operadora não informou validade. */
  passwordValidUntil: string | null;
  items: ReadonlyArray<{ quantityAuthorized: number; quantityConsumed: number }>;
}

/**
 * O que a tela diz. `today` é a data da clínica (AAAA-MM-DD). Vencida tem precedência sobre
 * consumida: com a senha vencida, o que sobrou não pode mais ser usado.
 */
export function authorizationDisplayState(a: AuthorizationForDisplay, today: string): AuthorizationDisplayState {
  if (!GRANTED_AUTHORIZATION.includes(a.status)) return a.status;
  if (a.passwordValidUntil && a.passwordValidUntil < today) return 'expired';
  const granted = a.items.filter((i) => i.quantityAuthorized > 0);
  if (granted.length > 0 && granted.every((i) => i.quantityConsumed >= i.quantityAuthorized)) return 'consumed';
  return a.status;
}

/** Quanto ainda dá para usar de um item (nunca negativo; a exceção aprovada fica no histórico). */
export function remainingQuantity(item: { quantityAuthorized: number; quantityConsumed: number }): number {
  return Math.max(0, item.quantityAuthorized - item.quantityConsumed);
}

// ── Comprovante ───────────────────────────────────────────────────────────────────────────

/** Os mesmos limites do banco (0146: `hi_authorization_attachments_size_chk` e `_type_chk`). */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/xml',
  'text/xml',
] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

export type ReceiptCheck =
  | { ok: true; mediaType: ReceiptMediaType }
  | { ok: false; reason: 'empty' | 'too_large' | 'type_not_allowed' | 'type_mismatch'; message: string };

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

function sniff(bytes: Uint8Array): 'pdf' | 'png' | 'jpeg' | 'xml' | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // XML: BOM opcional (UTF-8) e espaços antes do primeiro "<".
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c ? 'xml' : null;
}

const FAMILY: Record<ReceiptMediaType, ReturnType<typeof sniff>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

/** Confere o comprovante antes de cifrar e guardar. Mensagens para a tela, sem detalhe técnico. */
export function checkReceipt(bytes: Uint8Array, declaredType: string): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty', message: 'O arquivo está vazio.' };
  if (bytes.length > RECEIPT_MAX_BYTES)
    return { ok: false, reason: 'too_large', message: 'O comprovante passa de 10 MB. Envie um arquivo menor.' };
  const declared = declaredType.split(';')[0]!.trim().toLowerCase();
  if (!(RECEIPT_MEDIA_TYPES as readonly string[]).includes(declared))
    return { ok: false, reason: 'type_not_allowed', message: 'Envie o comprovante em PDF, PNG, JPEG ou XML.' };
  const mediaType = declared as ReceiptMediaType;
  if (sniff(bytes) !== FAMILY[mediaType])
    return {
      ok: false,
      reason: 'type_mismatch',
      message: 'O conteúdo do arquivo não corresponde ao tipo informado. Envie o comprovante original.',
    };
  return { ok: true, mediaType };
}
