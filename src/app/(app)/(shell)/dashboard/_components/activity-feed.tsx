import type { AuditActivity } from '@/lib/audit/recent';

const ACT_VERBS: Record<string, string> = {
  created: 'criado',
  updated: 'atualizado',
  paid: 'pago',
  cancelled: 'cancelado',
  estornado: 'estornado',
  removed: 'removido',
  set: 'definido',
  deactivated: 'desativado',
  signed: 'assinado',
  completed: 'concluído',
  deleted: 'excluído',
  exported: 'exportado',
  ativo: 'atualizado',
};
const ACT_ENTITIES: Record<string, string> = {
  supplier: 'Fornecedor',
  lancamento: 'Lançamento',
  procedure: 'Procedimento',
  prontuario: 'Prontuário',
  appointment: 'Atendimento',
  patient: 'Paciente',
  doctor_availability: 'Disponibilidade',
  clinic_holiday: 'Feriado',
  prescription: 'Prescrição',
  document: 'Documento',
  financial: 'Financeiro',
};

function humanizeAction(action: string): string {
  const segs = action.split('.');
  const last = segs[segs.length - 1] ?? action;
  const verb = ACT_VERBS[last] ?? last;
  let entity: string | undefined;
  for (let i = segs.length - 2; i >= 0; i--) {
    const e = ACT_ENTITIES[segs[i]!];
    if (e) {
      entity = e;
      break;
    }
  }
  entity ??= (segs[0] ?? '').replace(/_/g, ' ');
  return `${entity} ${verb}`.trim();
}

function relTime(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dd = Math.floor(h / 24);
  if (dd === 1) return 'ontem';
  if (dd < 7) return `há ${dd} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** Feed de atividade (audit) — 5 mais recentes, data sem quebra. */
export function ActivityFeed({
  activity,
  actorNames,
}: {
  activity: AuditActivity[];
  actorNames: Map<string, string>;
}) {
  return (
    <ul className="flex flex-col">
      {activity.slice(0, 5).map((a) => {
        const who = a.userId ? (actorNames.get(a.userId) ?? 'Sistema') : 'Sistema';
        return (
          <li
            key={a.id}
            className="flex items-start gap-3 border-b border-border py-3 text-(length:--fs-sm) first:pt-0 last:border-b-0 last:pb-0"
          >
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1 text-pretty font-medium">
              {humanizeAction(a.action)}
              <span className="mt-1 block text-(length:--fs-xs) font-normal text-fg-subtle">
                {who}
              </span>
            </span>
            <span className="shrink-0 font-mono text-(length:--fs-2xs) whitespace-nowrap text-fg-subtle">
              {relTime(a.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
