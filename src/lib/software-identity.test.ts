/**
 * P12.11 — identificação do software (R36/S7): fornecedor, software e versão do BUILD, iguais nas
 * telas e nos PDFs. Sem build, "sem build" (nunca uma versão inventada); valor fora do formato de
 * commit não vira versão.
 */
import { describe, expect, it } from 'vitest';

import { softwareIdentity, softwareIdentityLine } from './software-identity';

describe('identificação do software (P12.11)', () => {
  it('a versão é o commit publicado pela Vercel (12 caracteres), com fornecedor e software fixos', () => {
    const id = softwareIdentity({ VERCEL_GIT_COMMIT_SHA: 'A9FA253832AACD3D59E702937A389803768E8EEC' });
    expect(id).toEqual({ vendor: 'Qoro', name: 'Qoro Convênios', version: 'a9fa253832aa', standard: 'TISS 4.03.00' });
    expect(softwareIdentityLine(id)).toBe('Fornecedor Qoro · Qoro Convênios · versão a9fa253832aa · TISS 4.03.00');
  });

  it('sem build (local, teste) não inventa versão; valor que não é commit também não', () => {
    expect(softwareIdentity({}).version).toBeNull();
    expect(softwareIdentity({ VERCEL_GIT_COMMIT_SHA: '1.2.3-manual' }).version).toBeNull();
    expect(softwareIdentityLine(softwareIdentity({}))).toContain('versão sem build');
  });
});
