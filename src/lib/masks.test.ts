import { describe, expect, it } from 'vitest';

import { maskCep, maskCnpj, maskCpf, maskCpfCnpj, maskPhoneBR } from './masks';
import { redactCpf } from './format';

describe('maskCpf', () => {
  it('formata progressivamente', () => {
    expect(maskCpf('529')).toBe('529');
    expect(maskCpf('5299')).toBe('529.9');
    expect(maskCpf('529982247')).toBe('529.982.247');
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
  });
  it('bloqueia letras/Unicode e limita a 11 dígitos', () => {
    expect(maskCpf('52a9b9c8')).toBe('529.98');
    expect(maskCpf('529982247259999')).toBe('529.982.247-25');
    expect(maskCpf('５２９')).toBe(''); // dígitos full-width não são \d ASCII
  });
  it('idempotente e seguro p/ null/undefined/vazio', () => {
    expect(maskCpf(maskCpf('52998224725'))).toBe('529.982.247-25');
    expect(maskCpf(null)).toBe('');
    expect(maskCpf(undefined)).toBe('');
    expect(maskCpf('')).toBe('');
  });
});

describe('maskCnpj', () => {
  it('formata progressivamente', () => {
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCnpj('112223')).toBe('11.222.3');
  });
  it('idempotente + limite 14', () => {
    expect(maskCnpj(maskCnpj('11222333000181'))).toBe('11.222.333/0001-81');
    expect(maskCnpj('112223330001810000')).toBe('11.222.333/0001-81');
  });
});

describe('maskCpfCnpj — transição determinística 11↔14', () => {
  it('≤11 dígitos → CPF', () => {
    expect(maskCpfCnpj('52998224725')).toBe('529.982.247-25');
  });
  it('12º dígito → vira CNPJ', () => {
    expect(maskCpfCnpj('529982247251')).toBe('52.998.224/7251');
    expect(maskCpfCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('colar CNPJ já formatado permanece CNPJ (idempotente)', () => {
    expect(maskCpfCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
  });
});

describe('maskPhoneBR', () => {
  it('celular 11 díg → (11) 99000-0000', () => {
    expect(maskPhoneBR('11990000000')).toBe('(11) 99000-0000');
  });
  it('fixo 10 díg → (11) 0000-0000', () => {
    expect(maskPhoneBR('1130000000')).toBe('(11) 3000-0000');
  });
  it('progressivo', () => {
    expect(maskPhoneBR('1')).toBe('(1');
    expect(maskPhoneBR('11')).toBe('(11');
    expect(maskPhoneBR('119')).toBe('(11) 9');
    expect(maskPhoneBR('1199000')).toBe('(11) 9900-0');
  });
  it('bloqueia letras, limita 11, seguro null', () => {
    expect(maskPhoneBR('11a99')).toBe('(11) 99');
    expect(maskPhoneBR('119900000009999')).toBe('(11) 99000-0000');
    expect(maskPhoneBR(null)).toBe('');
    expect(maskPhoneBR('')).toBe('');
  });
});

describe('maskCep', () => {
  it('formata e limita', () => {
    expect(maskCep('01310100')).toBe('01310-100');
    expect(maskCep('013')).toBe('013');
    expect(maskCep(maskCep('01310100'))).toBe('01310-100');
  });
});

describe('redactCpf', () => {
  it('preserva 6 primeiros e 2 últimos e apaga o meio', () => {
    expect(redactCpf('41290871104')).toBe('412.908.***-04');
    expect(redactCpf('412.908.711-04')).toBe('412.908.***-04');
  });
  it('não exibe CPF incompleto pela metade', () => {
    expect(redactCpf('529982')).toBe('');
    expect(redactCpf(null)).toBe('');
    expect(redactCpf(undefined)).toBe('');
  });
  // O contrato que importa: nenhum dígito do meio sobrevive à redação.
  it('não deixa vazar os dígitos redigidos', () => {
    expect(redactCpf('41290871104')).not.toContain('711');
  });
});
