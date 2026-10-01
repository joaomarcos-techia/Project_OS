/**
 * §33 — Server Actions do perfil público. I/O mockado (auth, rate limit, cripto,
 * Graph e o seam de auditoria).
 *
 * O que este arquivo existe para provar, e que nenhum outro prova: que o
 * `phone_number_id` sai SEMPRE da conexão da clínica autenticada e nunca do
 * corpo; que o diff é calculado contra uma leitura fresca; e que o que volta
 * para a tela é o que a Meta reportou depois da escrita, não o que foi enviado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '@/lib/env';

const mocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireFreshPermission: vi.fn(async () => {}),
  requireClinicId: vi.fn(async () => 'clinic-da-sessao'),
  requireSuperAdmin: vi.fn(async () => {}),
}));
vi.mock('@/lib/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return { ...actual, assertWhatsappOnboardingReady: vi.fn() };
});
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async () => 'CIPHERTEXT_BLOB'),
  decryptForTenant: vi.fn(async () => 'token-em-claro'),
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertWhatsappProfileAllowed: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/messaging', () => ({
  upsertTenantConnection: vi.fn(async () => ({ id: 'num-1' })),
  deactivateTenantConnection: vi.fn(async () => ({
    disconnected: true,
    metaBusinessId: null,
    tokenCiphertext: null,
  })),
  recordConnectionFailure: vi.fn(async () => {}),
  recordProfileUpdated: vi.fn(async () => {}),
  loadConnectionForHealth: vi.fn(async () => ({
    id: 'conn-1',
    clinicId: 'clinic-da-sessao',
    metaPhoneId: 'phone-da-clinica',
    metaBusinessId: 'waba-1',
    tokenCiphertext: 'CIPHERTEXT_BLOB',
    connectionStatus: 'connected',
    coexistence: false,
  })),
  loadActiveNumberForSend: vi.fn(async () => null),
}));
vi.mock('./internal/meta-onboarding', () => ({
  exchangeCodeForToken: vi.fn(),
  validateTokenScopes: vi.fn(),
  resolveWabaAndPhone: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeAppToWaba: vi.fn(),
  ensureMessageTemplates: vi.fn(async () => []),
  unsubscribeAppFromWaba: vi.fn(),
}));
vi.mock('./internal/meta-business-profile', () => ({
  getBusinessProfile: vi.fn(),
  updateBusinessProfile: vi.fn(async () => {}),
}));

import { assertWhatsappProfileAllowed } from '@/lib/auth/rate-limit';
import { decryptForTenant } from '@/lib/crypto';
import { loadConnectionForHealth, recordProfileUpdated } from '@/lib/messaging';
import { requireFreshPermission } from '@/lib/auth/tenant-context';

import { getMyClinicWhatsappProfile, updateMyClinicWhatsappProfile } from './actions';
import { getBusinessProfile, updateBusinessProfile } from './internal/meta-business-profile';

const lido = (over: Record<string, unknown> = {}) => ({
  perfil: {
    about: 'antes',
    description: '',
    address: '',
    email: '',
    websites: [],
    vertical: 'UNDEFINED' as const,
    ...over,
  },
  verticalDesconhecida: null,
});

/** Corpo válido mínimo — os seis campos, sempre. */
const entrada = (over: Record<string, unknown> = {}) => ({
  about: 'antes',
  description: '',
  address: '',
  email: '',
  websites: [] as string[],
  vertical: 'UNDEFINED' as const,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertWhatsappProfileAllowed).mockResolvedValue({ ok: true });
  vi.mocked(loadConnectionForHealth).mockResolvedValue({
    id: 'conn-1',
    clinicId: 'clinic-da-sessao',
    metaPhoneId: 'phone-da-clinica',
    metaBusinessId: 'waba-1',
    tokenCiphertext: 'CIPHERTEXT_BLOB',
    connectionStatus: 'connected',
    coexistence: false,
  });
  vi.mocked(getBusinessProfile).mockResolvedValue(lido());
});

describe('isolamento — o phone_number_id nunca vem do corpo', () => {
  it('resolve o número pela clínica da SESSÃO, não por nada do input', async () => {
    await updateMyClinicWhatsappProfile(entrada({ about: 'depois' }));

    expect(loadConnectionForHealth).toHaveBeenCalledWith('clinic-da-sessao');
    // `clinic_whatsapp_numbers` é lida com service_role: a RLS não protege esta
    // consulta, quem protege é o WHERE clinic_id. Se este argumento passar a vir
    // do input, qualquer clínica autenticada reescreve o perfil público de outra.
    expect(vi.mocked(getBusinessProfile).mock.calls[0]?.[0]).toBe('phone-da-clinica');
    expect(vi.mocked(updateBusinessProfile).mock.calls[0]?.[0]).toBe('phone-da-clinica');
  });

  it.each(['phoneNumberId', 'clinicId', 'metaPhoneId', 'profile_picture_url'])(
    'RECUSA o corpo adulterado com %s em vez de descartar em silêncio',
    async (campo) => {
      // O caminho realista do ataque é adulterar o corpo da Server Action, não a
      // URL. `.strict()` transforma isso em recusa: descartar deixaria quem
      // tentou achando que funcionou.
      await expect(
        updateMyClinicWhatsappProfile(entrada({ [campo]: 'phone-de-outra-clinica' })),
      ).rejects.toThrow();

      expect(updateBusinessProfile).not.toHaveBeenCalled();
      // Nem o decrypt chega a rodar: entrada inválida não gasta cripto.
      expect(decryptForTenant).not.toHaveBeenCalled();
    },
  );
});

describe('sem número conectado', () => {
  it('a action recusa mesmo que a seção não devesse estar visível', async () => {
    vi.mocked(loadConnectionForHealth).mockResolvedValue(null);

    await expect(updateMyClinicWhatsappProfile(entrada())).rejects.toMatchObject({
      name: 'NumberNotConnectedError',
    });
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });

  it('a leitura também recusa', async () => {
    vi.mocked(loadConnectionForHealth).mockResolvedValue(null);
    await expect(getMyClinicWhatsappProfile()).rejects.toMatchObject({
      name: 'NumberNotConnectedError',
    });
  });
});

describe('perfil em coexistência', () => {
  it('recusa escrita antes de decifrar o token ou chamar a Meta', async () => {
    vi.mocked(loadConnectionForHealth).mockResolvedValue({
      id: 'conn-1',
      clinicId: 'clinic-da-sessao',
      metaPhoneId: 'phone-da-clinica',
      metaBusinessId: 'waba-1',
      tokenCiphertext: 'CIPHERTEXT_BLOB',
      connectionStatus: 'connected',
      coexistence: true,
    });

    await expect(updateMyClinicWhatsappProfile(entrada({ about: 'depois' }))).rejects.toMatchObject(
      {
        name: 'WhatsappProfileManagedInBusinessAppError',
        code: 'profile_managed_in_business_app',
      },
    );
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(getBusinessProfile).not.toHaveBeenCalled();
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });

  it('mantém a leitura para mostrar o estado informado pela Meta', async () => {
    vi.mocked(loadConnectionForHealth).mockResolvedValue({
      id: 'conn-1',
      clinicId: 'clinic-da-sessao',
      metaPhoneId: 'phone-da-clinica',
      metaBusinessId: 'waba-1',
      tokenCiphertext: 'CIPHERTEXT_BLOB',
      connectionStatus: 'connected',
      coexistence: true,
    });

    await getMyClinicWhatsappProfile();

    expect(getBusinessProfile).toHaveBeenCalledWith('phone-da-clinica', 'token-em-claro');
  });
});

describe('permissão e teto', () => {
  it('exige permissão FRESCA nas duas operações', async () => {
    await getMyClinicWhatsappProfile();
    expect(requireFreshPermission).toHaveBeenCalledWith('manage:settings');

    vi.clearAllMocks();
    vi.mocked(getBusinessProfile).mockResolvedValue(lido());
    await updateMyClinicWhatsappProfile(entrada());
    expect(requireFreshPermission).toHaveBeenCalledWith('manage:settings');
  });

  it('o teto recusa ANTES de decifrar o token e de falar com a Meta', async () => {
    vi.mocked(assertWhatsappProfileAllowed).mockResolvedValue({
      ok: false,
      reason: 'rate_limited',
    });

    await expect(updateMyClinicWhatsappProfile(entrada())).rejects.toMatchObject({
      name: 'MessagingRateLimitedError',
    });
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(getBusinessProfile).not.toHaveBeenCalled();
  });

  it('usa baldes separados para leitura e escrita', async () => {
    await getMyClinicWhatsappProfile();
    expect(assertWhatsappProfileAllowed).toHaveBeenCalledWith('clinic-da-sessao', 'read');

    vi.clearAllMocks();
    vi.mocked(assertWhatsappProfileAllowed).mockResolvedValue({ ok: true });
    vi.mocked(getBusinessProfile).mockResolvedValue(lido());
    await updateMyClinicWhatsappProfile(entrada());
    expect(assertWhatsappProfileAllowed).toHaveBeenCalledWith('clinic-da-sessao', 'write');
  });
});

describe('diff, escrita e auditoria', () => {
  it('não escreve nem audita quando nada mudou', async () => {
    const r = await updateMyClinicWhatsappProfile(entrada({ about: 'antes' }));

    expect(updateBusinessProfile).not.toHaveBeenCalled();
    expect(recordProfileUpdated).not.toHaveBeenCalled();
    expect(r.alterados).toEqual([]);
    // Uma leitura só: a segunda existe para confirmar a escrita que não houve.
    expect(getBusinessProfile).toHaveBeenCalledTimes(1);
  });

  it('escreve só os campos alterados, calculados contra a leitura fresca', async () => {
    await updateMyClinicWhatsappProfile(entrada({ about: 'depois', email: 'c@c.com' }));

    expect(vi.mocked(updateBusinessProfile).mock.calls[0]?.[3]).toEqual(['about', 'email']);
  });

  it('RELÊ depois de escrever e devolve o estado da Meta, não o enviado', async () => {
    vi.mocked(getBusinessProfile)
      .mockResolvedValueOnce(lido({ about: 'antes' }))
      // A Meta normalizou o texto — e é o normalizado que o paciente vê.
      .mockResolvedValueOnce(lido({ about: 'DEPOIS NORMALIZADO' }));

    const r = await updateMyClinicWhatsappProfile(entrada({ about: 'depois' }));

    expect(getBusinessProfile).toHaveBeenCalledTimes(2);
    expect(r.perfil.about).toBe('DEPOIS NORMALIZADO');
  });

  it('audita os NOMES dos campos, nunca os valores', async () => {
    vi.mocked(getBusinessProfile)
      .mockResolvedValueOnce(lido({ about: 'antes' }))
      .mockResolvedValueOnce(lido({ about: 'depois' }));

    await updateMyClinicWhatsappProfile(entrada({ about: 'depois' }));

    const arg = vi.mocked(recordProfileUpdated).mock.calls[0]?.[0];
    expect(arg?.changedFields).toEqual(['about']);
    expect(arg?.clinicId).toBe('clinic-da-sessao');
    expect(arg?.userId).toBe('user-1');
    expect(arg?.connectionId).toBe('conn-1');
    // A prosa livre não pode estar em lugar nenhum do payload de auditoria.
    expect(JSON.stringify(arg)).not.toContain('depois');
  });

  it('audita o que a RELEITURA mostrou, não o que se pretendia escrever', async () => {
    // Contar resposta não é ler estado. Se a Meta aplicar só parte do POST, a
    // auditoria tem de registrar o que de fato mudou.
    vi.mocked(getBusinessProfile)
      .mockResolvedValueOnce(lido({ about: 'antes', email: '' }))
      .mockResolvedValueOnce(lido({ about: 'depois', email: '' }));

    await updateMyClinicWhatsappProfile(entrada({ about: 'depois', email: 'c@c.com' }));

    // O POST pediu dois campos; a releitura mostra que só um pegou.
    expect(vi.mocked(updateBusinessProfile).mock.calls[0]?.[3]).toEqual(['about', 'email']);
    expect(vi.mocked(recordProfileUpdated).mock.calls[0]?.[0]?.changedFields).toEqual(['about']);
  });

  it('propaga a falha de escrita sem auditar', async () => {
    vi.mocked(updateBusinessProfile).mockRejectedValueOnce(new Error('graph caiu'));

    await expect(updateMyClinicWhatsappProfile(entrada({ about: 'depois' }))).rejects.toThrow(
      'graph caiu',
    );
    expect(recordProfileUpdated).not.toHaveBeenCalled();
  });

  it('propaga a falha de LEITURA sem escrever nada', async () => {
    vi.mocked(getBusinessProfile).mockRejectedValueOnce(new Error('graph fora'));

    await expect(updateMyClinicWhatsappProfile(entrada({ about: 'depois' }))).rejects.toThrow(
      'graph fora',
    );
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });
});

describe('leitura', () => {
  it('devolve o perfil e o aviso de vertical desconhecida', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({
      perfil: lido().perfil,
      verticalDesconhecida: 'MEDICAL_CLINIC',
    });

    const r = await getMyClinicWhatsappProfile();
    expect(r.verticalDesconhecida).toBe('MEDICAL_CLINIC');
    expect(vi.mocked(getBusinessProfile).mock.calls[0]?.[1]).toBe('token-em-claro');
  });
});
