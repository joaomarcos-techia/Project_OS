import { describe, expect, it } from 'vitest';
import { suggestEmailDomain } from './email-domain-suggestion';

describe('email domain hints', () => {
  it.each([
    ['ana@gmail.comq', 'ana@gmail.com'],
    ['Ana@GMIAL.COM', 'Ana@gmail.com'],
    ['ana@hotmail.con', 'ana@hotmail.com'],
    [' ana@outlok.com ', 'ana@outlook.com'],
  ])('suggests an explicit correction for %s', (address, expected) => {
    expect(suggestEmailDomain(address)).toBe(expected);
    expect(address).not.toBe(expected);
  });
  it.each([
    'ana@gmail.com',
    'ana@clinica.com.br',
    'ana@gmail.com.br',
    'ana@mail.example',
    'missing',
    'a@@gmail.comq',
  ])('does not restrict %s', (address) => {
    expect(suggestEmailDomain(address)).toBeNull();
  });
});
