/**
 * Server Actions do /join — as QUATRO transições do wizard e a separação de
 * identidades do checkout.
 *
 * O checkout misturava três papéis distintos: a CLÍNICA (pessoa jurídica que vai
 * usar o produto), o RESPONSÁVEL PELO ACESSO (quem loga) e o TITULAR DA COBRANÇA
 * (quem responde pelo cartão no Asaas). O documento da clínica era pré-preenchido
 * como documento do titular, e o e-mail do responsável ia para o cliente Asaas.
 * Os três podem ser pessoas diferentes.
 *
 * A invariante que estes testes protegem, e que é a razão do refactor:
 *   - o step_state guarda SOMENTE clínica, responsável e plano — nunca dado de
 *     cobrança, nunca cartão, nunca senha (`step-state.ts` é o contrato);
 *   - o Asaas e o registro local de billing usam EXCLUSIVAMENTE o titular
 *     informado no checkout;
 *   - o documento da clínica nunca vaza para o titular.
 *
 * As funções puras de step-state rodam de VERDADE (o módulo só depende de zod);
 * só o I/O é mockado. Sem isso o teste provaria a coreografia dos mocks, não a
 * transição.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // A classe vive AQUI porque `vi.mock` é içado acima de qualquer declaração
  // de topo: declará-la fora daria "cannot access before initialization".
  class FakeProvisionError extends Error {
    readonly code: string;
    constructor(message: string, code = 'onboarding_provision_failed') {
      super(message);
      this.name = 'OnboardingProvisionError';
      this.code = code;
    }
  }
  return {
    ProvisionError: FakeProvisionError,
    assertJoinAllowed: vi.fn(),
    captureBackgroundError: vi.fn(),
    createServerClient: vi.fn(),
    getClientIp: vi.fn(),
    guardedUpdateInvite: vi.fn(),
    headers: vi.fn(),
    loggerError: vi.fn(),
    resolveCheckoutPlan: vi.fn(),
    resolveOpenInvite: vi.fn(),
    runCheckout: vi.fn(),
  };
});

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertJoinAllowed: mocks.assertJoinAllowed,
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('@/lib/observability/capture', () => ({
  captureBackgroundError: mocks.captureBackgroundError,
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { error: mocks.loggerError } }));

// step-state é puro (só zod) e é o CONTRATO sob teste: as transições rodam de
// verdade. Mockar `advanceStep`/`parseStepState` provaria o mock, não o produto.
vi.mock('@/contexts/onboarding', async () => {
  const stepState = await import('@/contexts/onboarding/internal/step-state');
  return {
    OnboardingProvisionError: mocks.ProvisionError,
    QORO_TRIAL_DAYS: 14,
    advanceStep: stepState.advanceStep,
    parseStepState: stepState.parseStepState,
    stepStateSchema: stepState.stepStateSchema,
    guardedUpdateInvite: mocks.guardedUpdateInvite,
    resolveCheckoutPlan: mocks.resolveCheckoutPlan,
    resolveOpenInvite: mocks.resolveOpenInvite,
    runCheckout: mocks.runCheckout,
  };
});

import { CNPJ_INVALID_MESSAGE } from '@/lib/validation/cnpj';

import { saveStepAction, submitCheckoutAction } from './actions';

const TOKEN = 'a'.repeat(43);
const PLAN_ID = '00000000-0000-4000-8000-000000000002';

/** Responsável pelo ACESSO — quem loga. Não é o pagador. */
const OWNER = { nome: 'Responsável do Acesso', email: 'owner@example.test' };
/** CLÍNICA — pessoa jurídica que usa o produto. Documento próprio. */
const CLINIC = {
  nome: 'Clínica da Empresa',
  slug: 'clinica-da-empresa',
  cnpj: '11222333000181',
  telefone: '1130000000',
};
/** Estado completo, pronto para o checkout. */
const READY_STATE = {
  currentStep: 'checkout' as const,
  completed: ['clinic', 'owner', 'plan'] as const,
  clinic: CLINIC,
  owner: OWNER,
  planId: PLAN_ID,
};

function invite(stepState: unknown, over: Record<string, unknown> = {}) {
  return { id: 'invite-1', version: 4, status: 'started', stepState, ...over };
}

function stepForm(step: string, fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set('token', TOKEN);
  data.set('step', step);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

function checkoutForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values = {
    token: TOKEN,
    password: 'Senha!123',
    cardNumber: '4111111111111111',
    cardName: 'NOME IMPRESSO NO CARTAO',
    cardCvv: '123',
    cardExpiry: '12/30',
    billingHolderName: 'Pessoa Responsável pela Cobrança',
    billingHolderEmail: 'pagador@example.test',
    billingHolderPhone: '(11) 99000-0000',
    billingHolderCpfCnpj: '123.456.789-01',
    cep: '01001-000',
    addressNumber: '10',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** step_state que `guardedUpdateInvite` recebeu na última chamada. */
function persistedState(): Record<string, unknown> {
  const call = mocks.guardedUpdateInvite.mock.calls.at(-1);
  return (call?.[2] as { stepState: Record<string, unknown> }).stepState;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getClientIp.mockReturnValue('198.51.100.10');
  mocks.assertJoinAllowed.mockResolvedValue({ ok: true });
  mocks.guardedUpdateInvite.mockResolvedValue(true);
  mocks.resolveOpenInvite.mockResolvedValue(invite({}));
  mocks.resolveCheckoutPlan.mockResolvedValue({
    planId: PLAN_ID,
    code: 'clinica',
    priceId: '00000000-0000-4000-8000-000000000003',
    amountReais: 349,
    cycle: 'monthly',
  });
  mocks.runCheckout.mockResolvedValue({ clinicId: 'clinic-1' });
  mocks.createServerClient.mockResolvedValue({
    auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
  });
});

describe('saveStepAction — transição clínica → responsável', () => {
  it('grava a clínica com slug derivado e avança o passo', async () => {
    await expect(
      saveStepAction(
        { error: null },
        stepForm('clinic', {
          nome: 'Clínica da Empresa',
          cnpj: '11.222.333/0001-81',
          telefone: '(11) 3000-0000',
          email: 'contato@clinica.test',
          endereco: 'Rua A, 1',
        }),
      ),
    ).resolves.toEqual({ error: null, ok: true });

    expect(persistedState()).toMatchObject({
      currentStep: 'owner',
      completed: ['clinic'],
      clinic: expect.objectContaining({
        nome: 'Clínica da Empresa',
        slug: 'clinica-da-empresa',
        // Forma canônica (R16): o hash do CNPJ representa o documento, não a grafia.
        cnpj: '11222333000181',
      }),
    });
  });

  it('aceita o CNPJ alfanumérico e grava a forma canônica', async () => {
    await expect(
      saveStepAction(
        { error: null },
        stepForm('clinic', { nome: 'Clínica Nova', cnpj: '12.abc.345/01de-35' }),
      ),
    ).resolves.toEqual({ error: null, ok: true });
    expect(persistedState()).toMatchObject({
      clinic: expect.objectContaining({ cnpj: '12ABC34501DE35' }),
    });
  });

  it('recusa CNPJ inválido com a mensagem do CNPJ, sem avançar o passo', async () => {
    await expect(
      saveStepAction(
        { error: null },
        stepForm('clinic', { nome: 'Clínica Nova', cnpj: '11.222.333/0001-82' }),
      ),
    ).resolves.toEqual({ error: CNPJ_INVALID_MESSAGE });
  });

  it('campos opcionais vazios não viram string vazia no estado', async () => {
    await saveStepAction(
      { error: null },
      stepForm('clinic', {
        nome: 'Clínica Simples',
        cnpj: '',
        telefone: '',
        email: '',
        endereco: '',
      }),
    );
    const clinic = persistedState().clinic as Record<string, unknown>;
    expect(clinic.cnpj).toBeUndefined();
    expect(clinic.telefone).toBeUndefined();
  });

  it('recusa clínica sem nome', async () => {
    await expect(
      saveStepAction({ error: null }, stepForm('clinic', { nome: 'x' })),
    ).resolves.toEqual({ error: 'Verifique os dados da clínica (nome obrigatório).' });
    expect(mocks.guardedUpdateInvite).not.toHaveBeenCalled();
  });
});

describe('saveStepAction — transição responsável → plano', () => {
  it('grava nome e e-mail do responsável pelo ACESSO', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(
      invite({ currentStep: 'owner', completed: ['clinic'], clinic: CLINIC }),
    );
    await expect(
      saveStepAction({ error: null }, stepForm('owner', { nome: OWNER.nome, email: OWNER.email })),
    ).resolves.toEqual({ error: null, ok: true });

    expect(persistedState()).toMatchObject({
      currentStep: 'plan',
      completed: ['clinic', 'owner'],
      owner: OWNER,
      clinic: expect.objectContaining({ nome: CLINIC.nome }),
    });
  });

  it('recusa e-mail inválido do responsável', async () => {
    await expect(
      saveStepAction({ error: null }, stepForm('owner', { nome: 'Fulano', email: 'nao-e-email' })),
    ).resolves.toEqual({ error: 'Verifique nome e e-mail do gestor.' });
    expect(mocks.guardedUpdateInvite).not.toHaveBeenCalled();
  });
});

describe('saveStepAction — transição plano → checkout', () => {
  it('grava o plano escolhido', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(
      invite({ currentStep: 'plan', completed: ['clinic', 'owner'], clinic: CLINIC, owner: OWNER }),
    );
    await expect(
      saveStepAction({ error: null }, stepForm('plan', { planId: PLAN_ID })),
    ).resolves.toEqual({ error: null, ok: true });

    expect(persistedState()).toMatchObject({
      currentStep: 'checkout',
      completed: ['clinic', 'owner', 'plan'],
      planId: PLAN_ID,
    });
  });

  it('recusa planId que não é uuid', async () => {
    await expect(
      saveStepAction({ error: null }, stepForm('plan', { planId: 'plano-basico' })),
    ).resolves.toEqual({ error: 'Selecione um plano.' });
  });
});

describe('saveStepAction — o step_state NUNCA carrega dado de cobrança', () => {
  /**
   * É a invariante central do refactor. Um formulário adulterado que enviasse
   * campos de cobrança junto de um passo do wizard não pode fazê-los pousar no
   * `step_state`, que é retomável e sobrevive entre sessões.
   */
  it('descarta campos de cobrança injetados num passo do wizard', async () => {
    await saveStepAction(
      { error: null },
      stepForm('clinic', {
        nome: 'Clínica da Empresa',
        billingHolderCpfCnpj: '123.456.789-01',
        billingHolderEmail: 'pagador@example.test',
        cardNumber: '4111111111111111',
        cardCvv: '123',
        password: 'Senha!123',
      }),
    );

    const persisted = JSON.stringify(persistedState());
    for (const proibido of [
      '12345678901',
      '123.456.789-01',
      'pagador@example.test',
      '4111',
      '123',
    ]) {
      expect(persisted).not.toContain(proibido);
    }
    expect(Object.keys(persistedState()).sort()).toEqual(['clinic', 'completed', 'currentStep']);
  });
});

describe('saveStepAction — guardas', () => {
  it('token fora do formato nem consulta o convite', async () => {
    await expect(
      saveStepAction({ error: null }, stepForm('clinic', { token: 'curto', nome: 'Clínica' })),
    ).resolves.toEqual({ error: 'Convite inválido ou expirado.' });
    expect(mocks.resolveOpenInvite).not.toHaveBeenCalled();
  });

  it('passo desconhecido é recusado antes do rate-limit', async () => {
    await expect(
      saveStepAction({ error: null }, stepForm('faturamento', { nome: 'x' })),
    ).resolves.toEqual({ error: 'Passo inválido.' });
    expect(mocks.assertJoinAllowed).not.toHaveBeenCalled();
  });

  it('rate-limit barra antes de resolver o convite', async () => {
    mocks.assertJoinAllowed.mockResolvedValue({ ok: false });
    await expect(
      saveStepAction({ error: null }, stepForm('clinic', { nome: 'Clínica da Empresa' })),
    ).resolves.toEqual({
      error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    });
    expect(mocks.resolveOpenInvite).not.toHaveBeenCalled();
  });

  it('convite inexistente não grava nada', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(null);
    await expect(
      saveStepAction({ error: null }, stepForm('clinic', { nome: 'Clínica da Empresa' })),
    ).resolves.toEqual({ error: 'Convite inválido ou expirado.' });
    expect(mocks.guardedUpdateInvite).not.toHaveBeenCalled();
  });

  it('conflito de versão (outra aba) é reportado sem perder o passo', async () => {
    mocks.guardedUpdateInvite.mockResolvedValue(false);
    await expect(
      saveStepAction({ error: null }, stepForm('clinic', { nome: 'Clínica da Empresa' })),
    ).resolves.toEqual({
      error: 'O convite foi alterado em outra aba. Recarregue a página.',
    });
  });

  it('repetir um passo já concluído não duplica em `completed`', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(
      invite({ currentStep: 'owner', completed: ['clinic'], clinic: CLINIC }),
    );
    await saveStepAction({ error: null }, stepForm('clinic', { nome: 'Clínica Renomeada' }));
    expect(persistedState().completed).toEqual(['clinic']);
  });
});

describe('submitCheckoutAction — separação clínica × acesso × titular', () => {
  beforeEach(() => {
    mocks.resolveOpenInvite.mockResolvedValue(invite(READY_STATE));
  });

  it('cada papel vai para o seu destino, sem contaminação', async () => {
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: null,
      ok: true,
    });

    expect(mocks.runCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        clinic: expect.objectContaining({
          nome: 'Clínica da Empresa',
          cnpj: '11222333000181',
          telefone: '1130000000',
        }),
        owner: OWNER,
        billingContact: {
          name: 'Pessoa Responsável pela Cobrança',
          email: 'pagador@example.test',
          phone: '11990000000',
          cpfCnpj: '12345678901',
          postalCode: '01001000',
          addressNumber: '10',
        },
        card: expect.objectContaining({
          holderName: 'NOME IMPRESSO NO CARTAO',
          expiryMonth: '12',
          expiryYear: '2030',
        }),
      }),
    );
  });

  it('o documento da clínica NÃO vira documento do titular (prefill removido)', async () => {
    await submitCheckoutAction({ error: null }, checkoutForm());
    const args = mocks.runCheckout.mock.calls[0]![0] as {
      clinic: { cnpj: string | null };
      billingContact: { cpfCnpj: string };
    };
    expect(args.clinic.cnpj).toBe('11222333000181');
    expect(args.billingContact.cpfCnpj).toBe('12345678901');
    expect(args.billingContact.cpfCnpj).not.toBe(args.clinic.cnpj);
  });

  it('o e-mail do titular é o do checkout, não o do responsável pelo acesso', async () => {
    await submitCheckoutAction({ error: null }, checkoutForm());
    const args = mocks.runCheckout.mock.calls[0]![0] as {
      owner: { email: string };
      billingContact: { email: string };
    };
    expect(args.owner.email).toBe('owner@example.test');
    expect(args.billingContact.email).toBe('pagador@example.test');
  });

  it('aceita validade em MM/AAAA além de MM/AA', async () => {
    await submitCheckoutAction({ error: null }, checkoutForm({ cardExpiry: '07/2031' }));
    expect(mocks.runCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({ expiryMonth: '07', expiryYear: '2031' }),
      }),
    );
  });
});

describe('submitCheckoutAction — validação do titular e do cartão', () => {
  const INVALIDO = 'Verifique os dados do cartão e de cobrança (CPF/CNPJ, CEP, número).';

  beforeEach(() => {
    mocks.resolveOpenInvite.mockResolvedValue(invite(READY_STATE));
  });

  it.each([
    ['e-mail do titular inválido', { billingHolderEmail: 'invalido' }],
    ['nome do titular curto demais', { billingHolderName: 'A' }],
    ['telefone do titular com 9 dígitos', { billingHolderPhone: '119900000' }],
    ['CPF/CNPJ com tamanho inválido', { billingHolderCpfCnpj: '123' }],
    // Sem as letras sobrariam os 11 dígitos de um CPF com DV válido (R16).
    ['CPF/CNPJ com letras', { billingHolderCpfCnpj: 'ABC24971563792' }],
    [
      'CNPJ alfanumérico (gateway sem suporte documentado)',
      { billingHolderCpfCnpj: '12ABC34501DE35' },
    ],
    ['CEP incompleto', { cep: '0100' }],
    ['número do endereço ausente', { addressNumber: '' }],
    ['cartão curto demais', { cardNumber: '411111' }],
    ['CVV com 2 dígitos', { cardCvv: '12' }],
    ['validade malformada', { cardExpiry: '13-30' }],
    ['senha com menos de 8 caracteres', { password: 'curta' }],
  ])('recusa %s antes de tocar no Asaas', async (_caso, override) => {
    await expect(submitCheckoutAction({ error: null }, checkoutForm(override))).resolves.toEqual({
      error: INVALIDO,
    });
    expect(mocks.resolveCheckoutPlan).not.toHaveBeenCalled();
    expect(mocks.runCheckout).not.toHaveBeenCalled();
  });
});

describe('submitCheckoutAction — guardas e falhas de provisão', () => {
  beforeEach(() => {
    mocks.resolveOpenInvite.mockResolvedValue(invite(READY_STATE));
  });

  it('exige os passos anteriores concluídos', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(
      invite({ currentStep: 'checkout', completed: [], clinic: CLINIC }),
    );
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'Complete os passos anteriores antes de ativar.',
    });
    expect(mocks.runCheckout).not.toHaveBeenCalled();
  });

  it('convite já ativado não reprocessa', async () => {
    mocks.resolveOpenInvite.mockResolvedValue(invite(READY_STATE, { status: 'completed' }));
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'Convite inválido, expirado ou já ativado.',
    });
  });

  it('rate-limit barra antes de qualquer leitura', async () => {
    mocks.assertJoinAllowed.mockResolvedValue({ ok: false });
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    });
    expect(mocks.resolveOpenInvite).not.toHaveBeenCalled();
  });

  it('plano indisponível não chega ao provedor', async () => {
    mocks.resolveCheckoutPlan.mockResolvedValue(null);
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'Plano indisponível. Volte e escolha outro plano.',
    });
    expect(mocks.runCheckout).not.toHaveBeenCalled();
  });

  it('cartão recusado devolve a razão do provedor e marca cardError', async () => {
    mocks.runCheckout.mockRejectedValue(new mocks.ProvisionError('CPF inválido.', 'card_declined'));
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'CPF inválido. Nenhuma cobrança foi feita.',
      cardError: true,
    });
  });

  it('provedor fora do ar vira mensagem de tentar de novo', async () => {
    mocks.runCheckout.mockRejectedValue(
      new mocks.ProvisionError('timeout', 'provider_unreachable'),
    );
    const r = await submitCheckoutAction({ error: null }, checkoutForm());
    expect(r.error).toContain('indisponível agora');
    expect(r.cardError).toBeUndefined();
  });

  it('conflito de versão do convite', async () => {
    mocks.runCheckout.mockRejectedValue(new mocks.ProvisionError('v', 'invite_version_conflict'));
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: 'Este convite já foi ativado.',
    });
  });

  it('falha ao criar o acesso do responsável', async () => {
    mocks.runCheckout.mockRejectedValue(new mocks.ProvisionError('dup', 'owner_create_failed'));
    const r = await submitCheckoutAction({ error: null }, checkoutForm());
    expect(r.error).toContain('e-mail já em uso');
  });

  it('erro inesperado é capturado no Sentry e logado, sem vazar detalhe ao usuário', async () => {
    mocks.runCheckout.mockRejectedValue(new Error('boom interno com detalhe sensível'));
    const r = await submitCheckoutAction({ error: null }, checkoutForm());
    expect(r.error).toBe(
      'Falha ao ativar. Nenhuma cobrança foi confirmada — tente de novo em instantes.',
    );
    expect(r.error).not.toContain('boom interno');
    expect(mocks.captureBackgroundError).toHaveBeenCalledWith(expect.any(Error), {
      flow: 'checkout.activation',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith('checkout.activation_failed', {
      error: expect.any(Error),
    });
  });

  it('auto-login que falha NÃO derruba a ativação já concluída', async () => {
    mocks.createServerClient.mockRejectedValue(new Error('sessão indisponível'));
    await expect(submitCheckoutAction({ error: null }, checkoutForm())).resolves.toEqual({
      error: null,
      ok: true,
    });
    expect(mocks.runCheckout).toHaveBeenCalledTimes(1);
  });

  it('o auto-login usa o e-mail do ACESSO, nunca o do titular da cobrança', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerClient.mockResolvedValue({ auth: { signInWithPassword } });
    await submitCheckoutAction({ error: null }, checkoutForm());
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.test',
      password: 'Senha!123',
    });
  });
});
