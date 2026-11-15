/**
 * Texto de um evento do histórico da guia. Mudança de etapa: "Conferida → Aprovada". Alteração sem
 * mudança de etapa (o banco grava o NOME das colunas alteradas em `changed_fields`): diz o que mudou,
 * em vez de "Para conferir → Para conferir".
 */
import { GUIDE_STATUS_LABELS } from './guide-status-labels';

const FIELD_LABELS: Record<string, string> = {
  consulta_overrides: 'dados da consulta',
  plan_id: 'plano',
  membership_id: 'carteirinha',
  authorization_id: 'autorização',
  executant_professional_id: 'profissional executante',
  requester_professional_id: 'profissional solicitante',
  main_guide_id: 'guia principal',
  terminology_version: 'versão da terminologia',
  issues: 'pendências',
  expected_value_cents: 'valor previsto',
  total_value_cents: 'valor',
};

const label = (status: string): string => GUIDE_STATUS_LABELS[status] ?? status;

export function guideEventLabel(e: {
  fromStatus: string | null;
  toStatus: string | null;
  changedFields: readonly string[];
}): string {
  if (!e.toStatus) return 'Alteração';
  if (!e.fromStatus) return label(e.toStatus);
  if (e.fromStatus !== e.toStatus) return `${label(e.fromStatus)} → ${label(e.toStatus)}`;
  const fields = [...new Set(e.changedFields.map((f) => FIELD_LABELS[f] ?? 'outros dados'))];
  if (fields.length === 1 && fields[0] === 'dados da consulta') {
    return `Dados da consulta ajustados (etapa: ${label(e.toStatus)})`;
  }
  const what = fields.length > 0 ? `: ${fields.join(', ')}` : '';
  return `Guia alterada${what} (etapa: ${label(e.toStatus)})`;
}
