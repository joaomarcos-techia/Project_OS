/**
 * P6.1 — regras puras da autorização: transições (C.8), estado mostrado (consumida, vencida) e o
 * comprovante conferido pelos primeiros bytes nos limites do banco (0146).
 */
import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_STATUSES,
  authorizationDisplayState,
  canTransitionAuthorization,
  checkReceipt,
  RECEIPT_MAX_BYTES,
  remainingQuantity,
} from './authorization-rules';

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const XML = enc('﻿\n  <?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS/>');

describe('transições da autorização (C.8)', () => {
  it('concedida só vence ou é cancelada; final não muda; ninguém volta a pedida', () => {
    expect(canTransitionAuthorization('requested', 'authorized')).toBe(true);
    expect(canTransitionAuthorization('pending_operator', 'partially_authorized')).toBe(true);
    expect(canTransitionAuthorization('authorized', 'expired')).toBe(true);
    expect(canTransitionAuthorization('authorized', 'denied')).toBe(false);
    expect(canTransitionAuthorization('authorized', 'requested')).toBe(false);
    expect(canTransitionAuthorization('draft', 'authorized')).toBe(false);
    for (const final of ['denied', 'expired', 'cancelled'] as const)
      for (const to of AUTHORIZATION_STATUSES) expect(canTransitionAuthorization(final, to), `${final}→${to}`).toBe(false);
  });
});

describe('estado mostrado', () => {
  const items = [
    { quantityAuthorized: 4, quantityConsumed: 4 },
    { quantityAuthorized: 0, quantityConsumed: 0 },
  ];
  it('consumida quando tudo o que foi concedido foi usado (item negado não conta)', () => {
    expect(authorizationDisplayState({ status: 'partially_authorized', passwordValidUntil: '2026-12-31', items }, '2026-11-15')).toBe('consumed');
    expect(
      authorizationDisplayState(
        { status: 'authorized', passwordValidUntil: null, items: [{ quantityAuthorized: 4, quantityConsumed: 3 }] },
        '2026-11-15',
      ),
    ).toBe('authorized');
  });
  it('senha vencida aparece vencida antes da rotina gravar, e vence também o que foi consumido', () => {
    expect(authorizationDisplayState({ status: 'authorized', passwordValidUntil: '2026-11-14', items }, '2026-11-15')).toBe('expired');
    expect(authorizationDisplayState({ status: 'authorized', passwordValidUntil: '2026-11-15', items: [] }, '2026-11-15')).toBe('authorized');
  });
  it('pedida, negada e cancelada aparecem como estão', () => {
    for (const status of ['requested', 'denied', 'cancelled'] as const)
      expect(authorizationDisplayState({ status, passwordValidUntil: '2020-01-01', items }, '2026-11-15')).toBe(status);
  });
  it('o saldo nunca fica negativo', () => {
    expect(remainingQuantity({ quantityAuthorized: 4, quantityConsumed: 5 })).toBe(0);
    expect(remainingQuantity({ quantityAuthorized: 4, quantityConsumed: 1 })).toBe(3);
  });
});

describe('comprovante', () => {
  it('aceita PDF, PNG, JPEG e XML pelo conteúdo', () => {
    expect(checkReceipt(PDF, 'application/pdf')).toEqual({ ok: true, mediaType: 'application/pdf' });
    expect(checkReceipt(PNG, 'image/png')).toEqual({ ok: true, mediaType: 'image/png' });
    expect(checkReceipt(JPEG, 'image/jpeg; charset=binary')).toEqual({ ok: true, mediaType: 'image/jpeg' });
    expect(checkReceipt(XML, 'text/xml')).toEqual({ ok: true, mediaType: 'text/xml' });
  });
  it('recusa vazio, grande demais, tipo fora da lista e conteúdo que não bate com o tipo', () => {
    expect(checkReceipt(new Uint8Array(), 'application/pdf')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkReceipt(new Uint8Array(RECEIPT_MAX_BYTES + 1), 'application/pdf')).toMatchObject({ ok: false, reason: 'too_large' });
    expect(checkReceipt(PDF, 'application/zip')).toMatchObject({ ok: false, reason: 'type_not_allowed' });
    expect(checkReceipt(enc('MZ\x90\x00executavel'), 'application/pdf')).toMatchObject({ ok: false, reason: 'type_mismatch' });
    expect(checkReceipt(PNG, 'application/pdf')).toMatchObject({ ok: false, reason: 'type_mismatch' });
    for (const r of [checkReceipt(PNG, 'application/pdf'), checkReceipt(PDF, 'application/zip')])
      if (!r.ok) expect(r.message).not.toMatch(/mime|sniff|byte|0x/iu);
  });
});
