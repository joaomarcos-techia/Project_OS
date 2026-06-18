/**
 * Dunning state machine (C13). PURA e determinística: dias de atraso → estágio →
 * modo de acesso + canal de notificação. Respeita grace period (G9).
 *
 * Timeline (PlanoAção §13.2):
 *   D+1  → Asaas (lembrete nativo)
 *   D+3  → WhatsApp
 *   D+7  → WhatsApp + Email
 *   D+15 → access readonly (suspended_readonly)
 *   D+30 → access blocked (suspended)
 *
 * O TRANSPORTE de WhatsApp/email é da C14 (não existe ainda): o cron emite
 * `billing.clinic.dunning_advanced` e a C14 consome. Aqui só a regra de estágio.
 */
import type { AccessMode } from './access';

export interface DunningResult {
  stage: number; // 0 | 1 | 3 | 7 | 15 | 30
  access: AccessMode;
  /** canal devido AO ENTRAR neste estágio (null = nenhum/transição de acesso). */
  channel: 'asaas' | 'whatsapp' | 'email' | null;
}

const STAGE_THRESHOLDS = [30, 15, 7, 3, 1] as const;

const MS_PER_DAY = 86_400_000;

/** Dias de atraso considerando grace period (atraso só conta após o grace). */
export function daysOverdue(dueDate: Date, now: Date, graceUntil: Date | null): number {
  const effectiveDue = graceUntil && graceUntil.getTime() > dueDate.getTime() ? graceUntil : dueDate;
  const ms = now.getTime() - effectiveDue.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

export function dunningStageForDays(days: number): number {
  for (const s of STAGE_THRESHOLDS) if (days >= s) return s;
  return 0;
}

export function accessForStage(stage: number): AccessMode {
  if (stage >= 30) return 'blocked';
  if (stage >= 15) return 'readonly';
  return 'enabled';
}

function channelForStage(stage: number): DunningResult['channel'] {
  switch (stage) {
    case 1:
      return 'asaas';
    case 3:
      return 'whatsapp';
    case 7:
      return 'email';
    default:
      return null; // 15/30 são transições de acesso, não notificação suave
  }
}

export function evaluateDunning(dueDate: Date, now: Date, graceUntil: Date | null): DunningResult {
  const stage = dunningStageForDays(daysOverdue(dueDate, now, graceUntil));
  return { stage, access: accessForStage(stage), channel: channelForStage(stage) };
}
