/**
 * S3 — requisito 67 da ANS (8+ com maiúscula, minúscula, número e símbolo) nos CINCO caminhos que definem senha:
 * cadastro, continuação do cadastro, convite, recuperação/redefinição com perfil e redefinição sem perfil.
 *
 * Regras:
 *   - só vale com `TISS_SECURITY_PROFILE_ENFORCE=true` (desligado por padrão: nada muda para ninguém);
 *   - alcance = S1 (`tiss-scope.ts`): clínica com dado TISS ou módulo ligado; `TISS_SECURITY_PROFILE_SCOPE=platform`
 *     põe todos no alcance, inclusive quem ainda não tem clínica (cadastro);
 *   - SOMA à regra de cada fluxo; nunca afrouxa nenhuma;
 *   - se o rastro TISS não puder ser lido com o perfil ligado, aplica a regra mais forte (nunca a mais fraca).
 *
 * O leitor do rastro é injetado pela camada do app (`readClinicTissFootprint`, do Convênios): a lib não conhece
 * tabelas de contexto.
 */
import { decideTissScope, isTissProfileEnforced, type ClinicTissFootprint } from './tiss-scope';
import { tissPasswordProblems, type TissPasswordProblem } from './tiss-policies';

export type FootprintReader = (clinicId: string) => Promise<ClinicTissFootprint>;

const LABEL: Record<TissPasswordProblem, string> = {
  too_short: 'ao menos 8 caracteres',
  too_long: 'no máximo 72 bytes',
  uppercase: 'uma letra maiúscula',
  lowercase: 'uma letra minúscula',
  digit: 'um número',
  whitespace: 'nenhum espaço',
  control: 'nenhum caractere de controle',
  symbol: 'um símbolo',
};

/** `TISS_SECURITY_PROFILE_ENFORCE` e `TISS_SECURITY_PROFILE_SCOPE`; o padrão é o `process.env`. */
export type TissPasswordPolicyEnv = Readonly<Record<string, string | undefined>>;

/** `null` = a regra TISS não se aplica ou foi atendida; texto = o que falta, para mostrar ao usuário. */
export async function tissPasswordPolicyError(
  password: string,
  clinicId: string | null,
  readFootprint: FootprintReader,
  env: TissPasswordPolicyEnv = process.env,
): Promise<string | null> {
  if (!isTissProfileEnforced(env)) return null;
  const mode =
    env.TISS_SECURITY_PROFILE_SCOPE === 'platform' ? 'platform' : 'clinics_with_tiss_data';
  let inScope: boolean;
  if (mode === 'platform') inScope = true;
  else if (clinicId === null) inScope = false;
  else {
    try {
      inScope = decideTissScope(await readFootprint(clinicId), mode).inScope;
    } catch {
      inScope = true; // perfil ligado e rastro ilegível: a regra mais forte
    }
  }
  if (!inScope) return null;
  const problems = tissPasswordProblems(password);
  if (problems.length === 0) return null;
  const missing = problems.map((p) => LABEL[p]).join(', ');
  return `Esta clínica usa o perfil de segurança de Convênios (TISS): a senha precisa de ${missing}.`;
}
