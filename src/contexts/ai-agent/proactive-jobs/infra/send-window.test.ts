/**
 * ADR-066 — a janela de resposta da oferta da lista de espera corre só nas horas
 * em que a C14 envia (`claimDue`). Se uma mudar sem a outra, a oferta volta a
 * vencer em horas em que o convite não pode sair.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));

/* eslint-disable-next-line boundaries/element-types -- só o teste lê a política do Scheduling, para prender a janela da oferta à de envio. */
import { WAITLIST_OFFER_SEND_HOURS } from '@/contexts/scheduling/waitlist-policy';

import { SEND_WINDOW_END_HOUR, SEND_WINDOW_START_HOUR } from './repository';

describe('janela de envio da C14', () => {
  it('é a mesma em que corre a janela de resposta da oferta da lista de espera', () => {
    expect({ start: SEND_WINDOW_START_HOUR, end: SEND_WINDOW_END_HOUR }).toEqual(
      WAITLIST_OFFER_SEND_HOURS,
    );
  });
});
