/**
 * S1 — alcance do perfil de segurança `tiss` (componente de Segurança e Privacidade 202511 da ANS).
 *
 * Fundamento (pesquisa de 25/11/2026, `docs/convenios/QORO-TISS-CONFORMIDADE-REGULATORIA.md`, seção 4):
 * - escopo da norma: "todos os sistemas e portais que tratam os dados que fazem parte do Padrão TISS"
 *   (Componente Organizacional 202609, item 123);
 * - RN ANS 501/2022, art. 17: a solução tecnológica tem de atender "na íntegra" todos os componentes.
 *
 * Leitura conservadora adotada:
 * - os controles de SISTEMA (auditoria, registro de acesso, armazenamento da senha, limite de tentativas, TLS)
 *   valem para a plataforma inteira (já são globais ou passam a ser);
 * - os controles de USUÁRIO que mudam o uso (inatividade de 10 min, senha de 90 dias, histórico de 10,
 *   símbolo) valem para quem pode acessar dado TISS: os usuários das clínicas que TÊM dado TISS — com o
 *   módulo ligado OU com qualquer dado TISS guardado (desligar o módulo não apaga guia nem carteirinha) —
 *   e o suporte da plataforma quando entra nessas clínicas.
 * A feature flag sozinha NÃO tira ninguém do alcance: o critério é a existência do dado.
 *
 * Nada aqui liga o perfil: `TISS_SECURITY_PROFILE_ENFORCE` continua desligado até a aprovação de cada item.
 * Ampliar para a base inteira é trocar `scopeMode` para `platform` (sem migração).
 */

export type TissScopeMode = 'clinics_with_tiss_data' | 'platform';

export interface ClinicTissFootprint {
  moduleEnabled: boolean;
  /** Guias, carteirinhas, autorizações, lotes ou arquivos TISS guardados (qualquer estado). */
  hasTissData: boolean;
}

export type TissScopeDecision =
  | { inScope: true; reason: 'platform_mode' | 'module_enabled' | 'tiss_data_retained' }
  | { inScope: false; reason: 'no_tiss_data' };

export function decideTissScope(
  f: ClinicTissFootprint,
  mode: TissScopeMode = 'clinics_with_tiss_data',
): TissScopeDecision {
  if (mode === 'platform') return { inScope: true, reason: 'platform_mode' };
  if (f.moduleEnabled) return { inScope: true, reason: 'module_enabled' };
  if (f.hasTissData) return { inScope: true, reason: 'tiss_data_retained' };
  return { inScope: false, reason: 'no_tiss_data' };
}

/** Papel de plataforma (super admin/suporte) entrando numa clínica: herda o alcance da clínica, nunca o reduz. */
export function decidePlatformStaffScope(clinic: TissScopeDecision): TissScopeDecision {
  return clinic;
}

/** O perfil só é APLICADO com a flag ligada; o alcance é calculado sempre, para teste e simulação. */
export function isTissProfileEnforced(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.TISS_SECURITY_PROFILE_ENFORCE === 'true';
}

/** Tabelas cujo conteúdo, se existir para a clínica, a põe no alcance (só existência; nenhum conteúdo é lido). */
export const TISS_FOOTPRINT_TABLES = [
  'hi_guides',
  'hi_memberships',
  'hi_authorizations',
  'hi_batches',
  'hi_files',
] as const;
