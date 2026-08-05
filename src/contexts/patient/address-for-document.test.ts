import { describe, expect, it } from 'vitest';

import { formatDocumentAddress, pickPrincipalAddress } from './queries';
import { CreatePatientSchema, PatientAddressInputSchema } from './types';

describe('pickPrincipalAddress (seam getAddressForDocument)', () => {
  const mk = (id: string, principal: boolean, updatedAt: Date | null) =>
    ({ id, principal, updatedAt }) as { id: string; principal: boolean; updatedAt: Date | null };

  it('retorna null sem endereços', () => {
    expect(pickPrincipalAddress([])).toBeNull();
  });

  it('prefere o endereço principal', () => {
    const rows = [mk('a', false, new Date('2026-01-01')), mk('b', true, new Date('2025-01-01'))];
    expect(pickPrincipalAddress(rows)?.id).toBe('b');
  });

  it('sem principal, usa o mais recente (updatedAt desc)', () => {
    const rows = [mk('a', false, new Date('2025-01-01')), mk('b', false, new Date('2026-06-01'))];
    expect(pickPrincipalAddress(rows)?.id).toBe('b');
  });
});

describe('formatDocumentAddress (seam getAddressForDocument)', () => {
  it('formata logradouro, complemento — cidade/UF — CEP', () => {
    expect(
      formatDocumentAddress({
        logradouro: 'Rua das Flores, 50',
        complemento: 'Apto 12',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01000-000',
      }),
    ).toBe('Rua das Flores, 50, Apto 12 — São Paulo/SP — CEP 01000-000');
  });

  it('omite partes vazias', () => {
    expect(
      formatDocumentAddress({
        logradouro: 'Rua A, 1',
        complemento: null,
        cidade: 'Campinas',
        estado: 'SP',
        cep: null,
      }),
    ).toBe('Rua A, 1 — Campinas/SP');
  });

  it('retorna null quando tudo está vazio', () => {
    expect(
      formatDocumentAddress({
        logradouro: null,
        complemento: null,
        cidade: null,
        estado: null,
        cep: null,
      }),
    ).toBeNull();
  });
});

describe('PatientAddressInputSchema', () => {
  const ok = { logradouro: 'Rua A, 1', cidade: 'Campinas', estado: 'sp', cep: '13000-000' };

  it('aceita endereço válido e normaliza a UF para maiúsculas', () => {
    const r = PatientAddressInputSchema.safeParse(ok);
    expect(r.success).toBe(true);
    expect(r.success && r.data.estado).toBe('SP');
  });

  it('rejeita UF com tamanho diferente de 2', () => {
    expect(PatientAddressInputSchema.safeParse({ ...ok, estado: 'São' }).success).toBe(false);
  });

  it('exige logradouro, cidade e cep', () => {
    expect(PatientAddressInputSchema.safeParse({ estado: 'SP' }).success).toBe(false);
  });

  it('endereco é opcional em CreatePatientSchema', () => {
    const r = CreatePatientSchema.safeParse({
      nome: 'João da Silva',
      cpf: '390.533.447-05',
      email: 'joao@exemplo.com',
    });
    expect(r.success).toBe(true);
  });
});
