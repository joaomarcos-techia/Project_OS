export type AutomaticDunningStage = 3 | 7;
export type ManualCollectionStage = 'd15_review' | 'd30_manual';

export type DunningRoute =
  | { mode: 'none'; stages: [] }
  | { mode: 'automatic'; stages: AutomaticDunningStage[] }
  | { mode: 'manual'; stage: ManualCollectionStage };

/**
 * D+3 e D+7 sao contatos automaticos. A partir de D+15 o caso passa para
 * revisao humana; acima de 30 dias sobe de prioridade e nunca some da fila.
 */
export function routeDunning(daysOverdue: number): DunningRoute {
  if (daysOverdue < 3) return { mode: 'none', stages: [] };
  if (daysOverdue < 7) return { mode: 'automatic', stages: [3] };
  if (daysOverdue < 15) return { mode: 'automatic', stages: [3, 7] };
  if (daysOverdue <= 30) return { mode: 'manual', stage: 'd15_review' };
  return { mode: 'manual', stage: 'd30_manual' };
}

