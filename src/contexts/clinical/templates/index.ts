/**
 * Registry dos templates SOAP — em CÓDIGO, nunca no DB (R5 / §7.7).
 * MVP: 3 templates (clínico geral, pediatria, ginecologia). Crescer a lista =
 * adicionar um arquivo aqui; jamais um editor/seed no banco.
 */
import type { ClinicalTemplate } from '../types';

import { clinicoGeralTemplate } from './clinico-geral';
import { ginecologiaTemplate } from './ginecologia';
import { pediatriaTemplate } from './pediatria';

export const CLINICAL_TEMPLATES: readonly ClinicalTemplate[] = Object.freeze([
  clinicoGeralTemplate,
  pediatriaTemplate,
  ginecologiaTemplate,
]);

export function getTemplate(id: string): ClinicalTemplate | undefined {
  return CLINICAL_TEMPLATES.find((t) => t.id === id);
}

export function listTemplates(): ReadonlyArray<Pick<ClinicalTemplate, 'id' | 'nome' | 'especialidade'>> {
  return CLINICAL_TEMPLATES.map(({ id, nome, especialidade }) => ({ id, nome, especialidade }));
}
