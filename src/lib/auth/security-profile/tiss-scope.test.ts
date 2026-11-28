import { describe, expect, it } from 'vitest';

import { decidePlatformStaffScope, decideTissScope, isTissProfileEnforced } from './tiss-scope';

describe('S1 — alcance do perfil tiss', () => {
  it('clínica sem dado TISS e sem módulo fica fora (o uso dela não muda)', () => {
    expect(decideTissScope({ moduleEnabled: false, hasTissData: false })).toEqual({
      inScope: false,
      reason: 'no_tiss_data',
    });
  });

  it('módulo ligado entra', () => {
    expect(decideTissScope({ moduleEnabled: true, hasTissData: false }).inScope).toBe(true);
  });

  it('desligar o módulo NÃO tira do alcance enquanto houver dado TISS guardado', () => {
    expect(decideTissScope({ moduleEnabled: false, hasTissData: true })).toEqual({
      inScope: true,
      reason: 'tiss_data_retained',
    });
  });

  it('modo plataforma (leitura ampla, se a autoridade exigir) põe todas as clínicas no alcance', () => {
    expect(decideTissScope({ moduleEnabled: false, hasTissData: false }, 'platform')).toEqual({
      inScope: true,
      reason: 'platform_mode',
    });
  });

  it('suporte da plataforma herda o alcance da clínica em que entra', () => {
    const clinic = decideTissScope({ moduleEnabled: true, hasTissData: true });
    expect(decidePlatformStaffScope(clinic)).toEqual(clinic);
  });

  it('a aplicação do perfil só liga com a flag explícita', () => {
    expect(isTissProfileEnforced({})).toBe(false);
    expect(isTissProfileEnforced({ TISS_SECURITY_PROFILE_ENFORCE: '1' })).toBe(false);
    expect(isTissProfileEnforced({ TISS_SECURITY_PROFILE_ENFORCE: 'true' })).toBe(true);
  });
});
