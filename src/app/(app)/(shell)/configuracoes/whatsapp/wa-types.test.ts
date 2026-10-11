import { describe, expect, it } from 'vitest';

import { PerfilWhatsappSchema } from '@/contexts/messaging/business-profile-contract';
import {
  MessagingRateLimitedError,
  MessagingValidationError,
  MetaConnectError,
  NumberNotConnectedError,
  WhatsappProfileManagedInBusinessAppError,
} from '@/contexts/messaging/errors';

import { fail } from './wa-types';

describe('fail', () => {
  it('devolve a mensagem segura da validação de arquivo', () => {
    expect(fail(new MessagingValidationError('Formato inválido. Use PNG ou JPG.'))).toEqual({
      ok: false,
      code: 'validation',
      message: 'Formato inválido. Use PNG ou JPG.',
    });
  });

  it('expõe orientação da etapa sem vazar detalhes internos da Meta', () => {
    const result = fail(
      new MetaConnectError('[meta] graph HTTP 400 code=100 com token secreto', {
        stage: 'phone_registration',
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: 'META_AUTH_FAILED',
      message:
        'A Meta recusou a ativação do número. Confirme a verificação por SMS/voz e use um PIN novo de 6 dígitos, diferente do código recebido.',
    });
    if (result.ok) throw new Error('expected Meta connection failure');
    expect(result.message).not.toContain('code=100');
    expect(result.message).not.toContain('secreto');
  });

  // D78 — cada etapa nova precisa pedir uma AÇÃO diferente. Repetir a mensagem
  // de `account` mandaria o operador reconferir a conta durante uma
  // instabilidade da Meta, ou reconfirmar a conta quando falta escolher o número.
  it('separa seleção ambígua de número, indisponibilidade da Meta e falha de conta', () => {
    const messageFor = (stage: 'account' | 'phone_ambiguous' | 'provider_unavailable') => {
      const r = fail(new MetaConnectError('[meta] detalhe interno', { stage }));
      if (r.ok) throw new Error('expected Meta connection failure');
      return r.message;
    };

    const ambiguous = messageFor('phone_ambiguous');
    const unavailable = messageFor('provider_unavailable');
    const account = messageFor('account');

    expect(new Set([ambiguous, unavailable, account]).size).toBe(3);
    expect(ambiguous).toContain('mais de um número');
    expect(unavailable).toContain('Nada foi alterado');
    // Indisponibilidade não manda revisar a conta: não há evidência de recusa.
    expect(unavailable).not.toContain('Confirme a conta');
    for (const message of [ambiguous, unavailable, account]) {
      expect(message).not.toContain('detalhe interno');
    }
  });

  // D78 — a distinção precisa chegar à TELA, não só à auditoria. Rate limit
  // pede espera; resultado desconhecido de mutação não pode prometer que nada
  // mudou nem mandar repetir na hora.
  it('separa rate limit de resultado desconhecido e de indisponibilidade de leitura', () => {
    const messageFor = (
      stage: 'provider_rate_limited' | 'provider_outcome_unknown' | 'provider_unavailable',
    ) => {
      const r = fail(new MetaConnectError('[meta] graph HTTP 429 code=4', { stage }));
      if (r.ok) throw new Error('expected Meta connection failure');
      return r.message;
    };

    const rateLimited = messageFor('provider_rate_limited');
    const unknown = messageFor('provider_outcome_unknown');
    const unavailable = messageFor('provider_unavailable');

    expect(new Set([rateLimited, unknown, unavailable]).size).toBe(3);

    // Rate limit: só se afirma o que é verificável localmente — a conexão não
    // foi salva. NÃO se promete que o POST deixou de ser executado na Meta.
    expect(rateLimited).toContain('a conexão não foi salva');
    expect(rateLimited).toMatch(/[Aa]guarde/u);
    expect(rateLimited).not.toMatch(/[Nn]ada foi alterado/u);

    // Mutação indeterminada: NUNCA promete que nada mudou, e não manda reabrir
    // a tela — sem conexão persistida não há o que sondar ali.
    expect(unknown).not.toMatch(/[Nn]ada foi alterado/u);
    expect(unknown).not.toMatch(/reabra|reabrir/u);
    expect(unknown).toContain('a conexão não foi salva');
    expect(unknown).toContain('WhatsApp Manager');

    // Leitura indeterminada: aí sim é seguro dizer que nada mudou.
    expect(unavailable).toContain('Nada foi alterado');

    for (const message of [rateLimited, unknown, unavailable]) {
      expect(message).not.toContain('429');
      expect(message).not.toContain('code=4');
      expect(message).not.toMatch(/recusou/u);
    }
  });

  it('mantém mensagem genérica para uma etapa não identificada', () => {
    const result = fail(new MetaConnectError('[meta] falha desconhecida'));

    expect(result).toMatchObject({
      ok: false,
      code: 'META_AUTH_FAILED',
      message: 'Não foi possível conectar o WhatsApp. Tente novamente.',
    });
  });
});

describe('fail — §33, perfil público', () => {
  it('orienta editar no aplicativo quando o número usa coexistência', () => {
    const r = fail(new WhatsappProfileManagedInBusinessAppError());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('profile_managed_in_business_app');
    expect(r.message).toContain('aplicativo WhatsApp Business');
  });

  it('distingue o teto de LEITURA do de escrita', () => {
    // A frase do teto de escrita, dita a quem só abriu a tela, mandaria a
    // pessoa procurar uma alteração que ela não fez.
    const leitura = fail(new MessagingRateLimitedError('read'));
    const escrita = fail(new MessagingRateLimitedError('write'));

    expect(leitura.ok).toBe(false);
    expect(escrita.ok).toBe(false);
    if (leitura.ok || escrita.ok) return;

    expect(leitura.message).toContain('consultado muitas vezes');
    expect(leitura.message).not.toContain('alterações seguidas');
    expect(escrita.message).toContain('alterações seguidas');
    // Fomos nós que recusamos: "nada foi enviado" é afirmação segura, e é o
    // que separa este caso de `provider_rate_limited`.
    expect(escrita.message).toContain('Nada foi enviado');
  });

  it('devolve a mensagem por campo de um erro de validação', () => {
    const erro = PerfilWhatsappSchema.safeParse({
      about: 'a'.repeat(200),
      description: '',
      address: '',
      email: '',
      websites: [],
      vertical: 'HEALTH',
    });
    expect(erro.success).toBe(false);
    if (erro.success) return;

    const r = fail(erro.error);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('validation');
    expect(r.fields?.about).toContain('139');
    expect(r.message).toContain('campos destacados');
  });

  it('NÃO promete campo destacado quando a recusa é de raiz', () => {
    // Corpo com chave desconhecida — o caminho de adulteração. Não há campo a
    // realçar, e mandar "revise os campos destacados" seria mandar procurar um
    // realce que não existe.
    const erro = PerfilWhatsappSchema.safeParse({
      about: '',
      description: '',
      address: '',
      email: '',
      websites: [],
      vertical: 'HEALTH',
      phoneNumberId: 'phone-de-outra-clinica',
    });
    expect(erro.success).toBe(false);
    if (erro.success) return;

    const r = fail(erro.error);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).not.toContain('destacados');
    expect(r.message).toContain('Nada foi alterado');
  });

  it('traduz número não conectado sem expor o clinicId da mensagem interna', () => {
    const r = fail(new NumberNotConnectedError('11111111-1111-1111-1111-111111111111'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('number_not_connected');
    expect(r.message).not.toContain('11111111');
  });

  it.each(['profile_read', 'profile_write'] as const)(
    'tem mensagem própria para a etapa %s',
    (stage) => {
      const r = fail(new MetaConnectError('[meta] graph HTTP 400 code=100', { stage }));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.message.length).toBeGreaterThan(20);
      // A da leitura precisa dizer que nada mudou: é o que impede a pessoa de
      // concluir que o perfil está vazio e salvar por cima.
      if (stage === 'profile_read') expect(r.message).toContain('Nada foi alterado');
    },
  );
});
