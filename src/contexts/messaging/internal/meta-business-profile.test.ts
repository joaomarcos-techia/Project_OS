/**
 * §33 — leitura e escrita do perfil público, com `fetch` global mockado.
 *
 * Cobre o que só se vê no contato com o Graph: endpoint e método, o que a
 * normalização faz com resposta torta, quais campos saem no POST, a
 * reetiquetagem de recusa conteúdal, e que o token nunca aparece em erro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    META_APP_ID: 'app-123',
    META_APP_SECRET: 'secret-xyz',
    META_GRAPH_API_VERSION: 'v21.0',
    META_HTTP_TIMEOUT_MS: 10_000,
  },
}));

import { MetaConnectError } from '../errors';

import { getBusinessProfile, updateBusinessProfile } from './meta-business-profile';

const TOKEN = 'TOKEN_SUPER_SECRETO_NAO_VAZE';
const PHONE = 'phone-123';

type Body = Record<string, unknown>;
const res = (body: Body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (call: unknown[]) => String(call[0]);
const optOf = (call: unknown[]) => call[1] as RequestInit & { headers: Record<string, string> };
const bodyOf = (call: unknown[]) => JSON.parse(String(optOf(call).body)) as Body;

const perfilCheio = {
  about: 'Saúde mental',
  description: 'Clínica',
  address: 'Rua A, 1',
  email: 'c@c.com',
  websites: ['https://c.com'],
  vertical: 'HEALTH' as const,
};

describe('getBusinessProfile', () => {
  it('chama o endpoint do phone-number-id com os campos e o Bearer', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ about: 'oi' }] }));
    await getBusinessProfile(PHONE, TOKEN);

    const url = new URL(urlOf(fetchMock.mock.calls[0]!));
    expect(url.pathname).toBe(`/v21.0/${PHONE}/whatsapp_business_profile`);
    // O endpoint é no NÚMERO, não na WABA — trocar isso devolveria 400 opaco.
    expect(url.pathname).not.toContain('waba');
    expect(url.searchParams.get('fields')).toBe(
      'about,address,description,email,websites,vertical',
    );
    // §33.6 — a foto está fora de escopo e não pode entrar de carona.
    expect(url.searchParams.get('fields')).not.toContain('profile_picture_url');
    expect(optOf(fetchMock.mock.calls[0]!).method).toBe('GET');
    expect(optOf(fetchMock.mock.calls[0]!).headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('trata `data: []` como perfil vazio, não como erro', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    const r = await getBusinessProfile(PHONE, TOKEN);
    expect(r.perfil).toEqual({
      about: '',
      description: '',
      address: '',
      email: '',
      websites: [],
      vertical: 'UNDEFINED',
    });
    expect(r.verticalDesconhecida).toBeNull();
  });

  it('normaliza campos ausentes e de tipo inesperado sem lançar', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ about: 42, websites: 'https://nao-e-array.com', email: null }] }),
    );
    const r = await getBusinessProfile(PHONE, TOKEN);
    expect(r.perfil.about).toBe('');
    expect(r.perfil.websites).toEqual([]);
    expect(r.perfil.email).toBe('');
  });

  it('descarta entradas não-string e vazias de websites, preservando a ordem', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ websites: ['https://a.com', '   ', 7, 'https://b.com'] }] }),
    );
    const r = await getBusinessProfile(PHONE, TOKEN);
    expect(r.perfil.websites).toEqual(['https://a.com', 'https://b.com']);
  });

  it('preserva vertical conhecida', async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ vertical: 'HEALTH' }] }));
    const r = await getBusinessProfile(PHONE, TOKEN);
    expect(r.perfil.vertical).toBe('HEALTH');
    expect(r.verticalDesconhecida).toBeNull();
  });

  it('DENUNCIA vertical desconhecida em vez de fingir que é UNDEFINED', async () => {
    // A Meta acrescenta valores ao enum sem aviso. Se este sinal sumir, a tela
    // exibe uma categoria que não é a real e o salvamento pode apagá-la.
    fetchMock.mockResolvedValueOnce(res({ data: [{ vertical: 'MEDICAL_CLINIC' }] }));
    const r = await getBusinessProfile(PHONE, TOKEN);
    expect(r.perfil.vertical).toBe('UNDEFINED');
    expect(r.verticalDesconhecida).toBe('MEDICAL_CLINIC');
  });
});

describe('updateBusinessProfile', () => {
  it('NÃO chama o Graph quando não há campo alterado', async () => {
    await updateBusinessProfile(PHONE, TOKEN, perfilCheio, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia SÓ os campos alterados, mais o messaging_product', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about']);

    const body = bodyOf(fetchMock.mock.calls[0]!);
    expect(body).toEqual({ messaging_product: 'whatsapp', about: 'Saúde mental' });
    // A ausência é o ponto: reenviar `vertical` apagaria uma categoria que a
    // Meta conhece e nós não.
    expect(body).not.toHaveProperty('vertical');
    expect(body).not.toHaveProperty('email');
    expect(optOf(fetchMock.mock.calls[0]!).method).toBe('POST');
  });

  it('envia o array de sites inteiro quando websites mudou', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['websites']);
    expect(bodyOf(fetchMock.mock.calls[0]!).websites).toEqual(['https://c.com']);
  });

  it('envia string vazia para apagar um campo', async () => {
    fetchMock.mockResolvedValueOnce(res({ success: true }));
    await updateBusinessProfile(PHONE, TOKEN, { ...perfilCheio, about: '' }, ['about']);
    expect(bodyOf(fetchMock.mock.calls[0]!).about).toBe('');
  });
});

describe('classificação de falha', () => {
  it('um 400 de conteúdo vira profile_write, não outcome_unknown', async () => {
    // Regressão do defeito encontrado ao implementar: `400 code=100` cai em
    // `indeterminate` na classificação D78, e o POST viraria
    // "a Meta não confirmou o resultado" — texto que manda a pessoa procurar o
    // problema no WhatsApp Manager por causa de um endereço malformado.
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));
    await expect(updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about'])).rejects.toMatchObject(
      { name: 'MetaConnectError', stage: 'profile_write' },
    );
  });

  it('um 400 de conteúdo na leitura vira profile_read', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 100 } }, false, 400));
    await expect(getBusinessProfile(PHONE, TOKEN)).rejects.toMatchObject({
      stage: 'profile_read',
    });
  });

  it('rate limit CONTINUA rate limit — a orientação é esperar, não revisar texto', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 4 } }, false, 400));
    await expect(updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about'])).rejects.toMatchObject(
      { stage: 'provider_rate_limited' },
    );
  });

  it('5xx num POST continua provider_outcome_unknown — ali a dúvida é real', async () => {
    // Não dá para afirmar que nada mudou depois de um 500: a requisição pode
    // ter sido aplicada. Reetiquetar isto seria inventar certeza.
    fetchMock.mockResolvedValueOnce(res({}, false, 503));
    await expect(updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about'])).rejects.toMatchObject(
      { stage: 'provider_outcome_unknown' },
    );
  });

  it('timeout num POST continua provider_outcome_unknown', async () => {
    fetchMock.mockRejectedValueOnce(new Error('AbortError'));
    await expect(updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about'])).rejects.toMatchObject(
      { stage: 'provider_outcome_unknown' },
    );
  });

  it('um 403 continua negativa de autorização da etapa', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: { code: 190 } }, false, 403));
    await expect(getBusinessProfile(PHONE, TOKEN)).rejects.toMatchObject({
      stage: 'profile_read',
    });
  });
});

describe('o token nunca vaza', () => {
  it.each([
    ['400 de conteúdo', res({ error: { code: 100 } }, false, 400)],
    ['500', res({}, false, 500)],
  ])('não aparece na mensagem nem na cadeia de causas — %s', async (_nome, resposta) => {
    fetchMock.mockResolvedValue(resposta);
    try {
      await updateBusinessProfile(PHONE, TOKEN, perfilCheio, ['about']);
      throw new Error('deveria ter lançado');
    } catch (err) {
      let atual: unknown = err;
      let voltas = 0;
      while (atual instanceof Error && voltas < 10) {
        expect(atual.message).not.toContain(TOKEN);
        expect(JSON.stringify(atual.message)).not.toContain(TOKEN);
        atual = (atual as { cause?: unknown }).cause;
        voltas += 1;
      }
      expect(err).toBeInstanceOf(MetaConnectError);
    }
  });

  it('não aparece na mensagem quando o Graph fica inalcançável', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(getBusinessProfile(PHONE, TOKEN)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(TOKEN) }) as Error,
    );
  });
});
