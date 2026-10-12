import { describe, expect, it } from 'vitest';

import { identidadeDoContato, telefoneDoContato } from './contact-identity';

describe('telefoneDoContato', () => {
  it('formata o número nacional que o cadastro grava', () => {
    expect(telefoneDoContato('11988421190')).toBe('(11) 98842-1190');
  });

  it('formata fixo de 10 dígitos', () => {
    expect(telefoneDoContato('1140002088')).toBe('(11) 4000-2088');
  });

  it('separa o DDI e usa o formato internacional do WhatsApp', () => {
    // Sem separar, `maskPhoneBR` corta em 11 dígitos e devolve `(55) 11988-4211`
    // — um telefone que não existe. É a forma que o webhook do WhatsApp grava.
    expect(telefoneDoContato('5511988421190')).toBe('+55 11 98842-1190');
    expect(telefoneDoContato('+55 (11) 98842-1190')).toBe('+55 11 98842-1190');
    expect(telefoneDoContato('551140002088')).toBe('+55 11 4000-2088');
  });

  it('formata o celular de antes do nono dígito, como o WhatsApp o identifica', () => {
    // wa_id real de 12 dígitos: 55 + DDD 88 + 8 dígitos começando em 9.
    expect(telefoneDoContato('558897168587')).toBe('+55 88 9716-8587');
    expect(telefoneDoContato('556181234567')).toBe('+55 61 8123-4567');
  });

  it('devolve cru o que não tem forma de telefone BR', () => {
    // `+12025550147` (EUA) tem os MESMOS 11 dígitos de um celular brasileiro:
    // só o plano de numeração separa os dois — aqui, o 9 obrigatório do celular.
    expect(telefoneDoContato('+12025550147')).toBe('+12025550147');
    expect(telefoneDoContato('123')).toBe('123');
    // DDD não tem zero, e fixo não começa em 9.
    expect(telefoneDoContato('0140002088')).toBe('0140002088');
    expect(telefoneDoContato('2040002088')).toBe('2040002088');
    expect(telefoneDoContato('1190002088')).toBe('1190002088');
    // O formato antigo do celular só existe com DDI (wa_id da Meta): sem o 55,
    // 10 dígitos começando em 9 continuam sem forma reconhecível.
    expect(telefoneDoContato('8897168587')).toBe('8897168587');
  });
});

describe('identidadeDoContato', () => {
  it('põe o nome no título e o telefone embaixo quando há cadastro', () => {
    expect(
      identidadeDoContato({
        patientDisplayName: 'Marina Bastos Rezende',
        contactPhone: '11988421190',
        maskedPhone: null,
      }),
    ).toEqual({ titulo: 'Marina Bastos Rezende', telefone: '(11) 98842-1190' });
  });

  it('não repete o telefone quando ele já é o título', () => {
    // Contato sem cadastro: o telefone é o único dado que existe. Ecoá-lo na
    // linha de baixo ocupa espaço sem acrescentar nada.
    expect(
      identidadeDoContato({
        patientDisplayName: null,
        contactPhone: '11977310455',
        maskedPhone: '+1197*****0455',
      }),
    ).toEqual({ titulo: '(11) 97731-0455', telefone: null });
  });

  it('cai no telefone mascarado quando o contato não pôde ser decifrado', () => {
    expect(
      identidadeDoContato({
        patientDisplayName: null,
        contactPhone: null,
        maskedPhone: '+1197*****0455',
      }),
    ).toEqual({ titulo: '+1197*****0455', telefone: null });
  });

  it('sem cadastro, usa o nome do perfil do WhatsApp e mantém o telefone embaixo', () => {
    expect(
      identidadeDoContato({
        patientDisplayName: null,
        contactName: 'Maria do WhatsApp',
        contactPhone: '558897168587',
        maskedPhone: '+5588*****8587',
      }),
    ).toEqual({ titulo: 'Maria do WhatsApp', telefone: '+55 88 9716-8587' });
  });

  it('o nome do cadastro vence o do WhatsApp', () => {
    expect(
      identidadeDoContato({
        patientDisplayName: 'Marina Bastos Rezende',
        contactName: 'Mari',
        contactPhone: '5511988421190',
        maskedPhone: null,
      }),
    ).toEqual({ titulo: 'Marina Bastos Rezende', telefone: '+55 11 98842-1190' });
  });

  it('não inventa identidade quando não há nome nem telefone', () => {
    expect(
      identidadeDoContato({ patientDisplayName: null, contactPhone: null, maskedPhone: null }),
    ).toEqual({ titulo: 'Contato desconhecido', telefone: null });
  });
});
