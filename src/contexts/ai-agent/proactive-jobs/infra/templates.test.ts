import { describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/lib/env';
import {
  PROACTIVE_TEMPLATE_BODIES,
  PROACTIVE_TEMPLATE_KINDS,
  countTemplateVariables,
} from '@/lib/messaging/proactive-template-catalog';

import type {
  DepositLinkPayload,
  DunningPayload,
  FollowupPayload,
  ReminderPayload,
  WaitlistOfferPayload,
} from '../domain/types';

// O ambiente de teste não configura os nomes; sem isto `envName()` lançaria
// `TemplateNotConfiguredError` e o teste passaria vazio — que é o modo de falha
// que ele existe para impedir.
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      META_TEMPLATE_CONFIRMATION_REMINDER_ID: 'lembrete_confirmacao',
      META_TEMPLATE_DUNNING_FRIENDLY_ID: 'amigavel_cobranca',
      META_TEMPLATE_WAITLIST_OFFER_ID: 'lista_espera_oferta',
      META_TEMPLATE_FOLLOWUP_RETURN_ID: 'retorno_consulta',
      META_TEMPLATE_DEPOSIT_LINK_ID: 'sinal_link_pagamento',
      META_TEMPLATE_LANG: 'pt_BR',
    },
  };
});

const { buildProactiveTemplate } = await import('./templates');

const TZ = 'America/Sao_Paulo';

/** Payloads mínimos por tipo — o que importa é a CONTAGEM, não o conteúdo. */
const PAYLOADS = {
  reminder: {
    appointmentId: '11111111-1111-1111-1111-111111111111',
    patientId: '22222222-2222-2222-2222-222222222222',
    scheduledAt: '2026-08-18T12:00:00.000Z',
    doctorNome: 'Ana Costa',
  } as unknown as ReminderPayload,
  dunning: {
    lancamentoId: '33333333-3333-3333-3333-333333333333',
    patientId: '22222222-2222-2222-2222-222222222222',
    dueDate: '2026-08-10',
    valor: 150,
  } as unknown as DunningPayload,
  waitlist_offer: {
    appointmentId: '44444444-4444-4444-4444-444444444444',
    patientId: '22222222-2222-2222-2222-222222222222',
    scheduledAt: '2026-08-18T12:00:00.000Z',
    doctorNome: 'Ana Costa',
  } as unknown as WaitlistOfferPayload,
  followup: {
    patientId: '22222222-2222-2222-2222-222222222222',
    doctorNome: 'Ana Costa',
  } as unknown as FollowupPayload,
  deposit_link: {
    patientId: '22222222-2222-2222-2222-222222222222',
    chargeId: '55555555-5555-5555-5555-555555555555',
    appointmentId: '44444444-4444-4444-4444-444444444444',
    amount: 150,
    holdExpiresAt: '2026-08-18T12:00:00.000Z',
  } as unknown as DepositLinkPayload,
} as const;

/**
 * O que NÃO vem do payload. O link do sinal é resolvido no send-time (ele não
 * pode ficar em repouso na fila), então o builder o recebe por argumento.
 */
const EXTRAS: Partial<Record<keyof typeof PAYLOADS, { invoiceUrl?: string }>> = {
  deposit_link: { invoiceUrl: 'https://www.asaas.com/i/abc123' },
};

/**
 * A trava que sustenta o provisionamento automático: a copy aprovada na Meta e a
 * ordem montada no envio vivem em arquivos diferentes, porque os dois contextos
 * não podem se importar. Nada além deste teste impede que uma mude sem a outra.
 *
 * Divergência aqui vira `132000 number of parameters mismatch` em produção —
 * silencioso, por clínica, e só na hora de enviar.
 */
describe('templates proativos — copy × ordem das variáveis', () => {
  const kinds = [...PROACTIVE_TEMPLATE_KINDS];

  it('exercita todos os tipos do catálogo', () => {
    expect(kinds).toHaveLength(5);
  });

  it.each(kinds)('%s: o corpo declara tantas variáveis quanto o builder envia', (kind) => {
    const built = buildProactiveTemplate(kind, PAYLOADS[kind], 'Maria Silva', TZ, EXTRAS[kind]);
    expect(built.variables).toHaveLength(
      countTemplateVariables(PROACTIVE_TEMPLATE_BODIES[kind].body),
    );
  });

  it.each(kinds)('%s: nenhuma variável sai vazia', (kind) => {
    // Vazio é recusado no envio e é o sintoma de um fallback esquecido.
    const built = buildProactiveTemplate(kind, PAYLOADS[kind], 'Maria Silva', TZ, EXTRAS[kind]);
    for (const v of built.variables) expect(v.trim()).not.toBe('');
  });

  it.each(kinds)('%s: usa o idioma do catálogo', (kind) => {
    const built = buildProactiveTemplate(kind, PAYLOADS[kind], 'Maria Silva', TZ, EXTRAS[kind]);
    expect(built.languageCode).toBe('pt_BR');
  });

  it('usa o profissional quando há, e o fallback quando não há', () => {
    const semMedico = buildProactiveTemplate(
      'waitlist_offer',
      { ...PAYLOADS.waitlist_offer, doctorNome: null } as unknown as WaitlistOfferPayload,
      'Maria Silva',
      TZ,
    );
    expect(semMedico.variables[3]).toBe('nossa equipe');

    const followupSemMedico = buildProactiveTemplate(
      'followup',
      { ...PAYLOADS.followup, doctorNome: null } as unknown as FollowupPayload,
      'Maria Silva',
      TZ,
    );
    expect(followupSemMedico.variables[1]).toBe('seu médico');
  });
});
