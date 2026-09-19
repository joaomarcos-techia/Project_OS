import {
  Banknote,
  Calendar,
  CircleDot,
  FileText,
  ListChecks,
  PenLine,
  ShieldCheck,
  Truck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { AuditActivity } from '@/lib/audit/recent';

/**
 * Terceira pessoa do pretérito — a referência escreve o feed como FRASE, com
 * quem agiu no começo: "Dra. Ana Moraes assinou o prontuário". A forma anterior
 * ("Prontuário assinado", ator numa segunda linha) enterrava justamente o dado
 * que faz alguém olhar um log de auditoria, que é quem mexeu.
 */
const ACT_VERBS: Record<string, string> = {
  created: 'criou',
  updated: 'atualizou',
  paid: 'pagou',
  cancelled: 'cancelou',
  estornado: 'estornou',
  refunded: 'estornou',
  removed: 'removeu',
  set: 'definiu',
  deactivated: 'desativou',
  signed: 'assinou',
  completed: 'concluiu',
  deleted: 'excluiu',
  exported: 'exportou',
  ativo: 'atualizou',
  generated: 'gerou',
  finalized: 'finalizou',
  sent: 'enviou',
  revoked: 'revogou',
  restored: 'restaurou',
  archived: 'arquivou',
  started: 'iniciou',
  invited: 'convidou',
  imported: 'importou',
  scheduled: 'agendou',
  rescheduled: 'remarcou',
  confirmed: 'confirmou',
};

/** `artigo` evita "assinou prontuário"; `icon` é o glifo da referência. */
const ACT_ENTITIES: Record<string, { label: string; artigo: 'o' | 'a'; icon: LucideIcon }> = {
  supplier: { label: 'fornecedor', artigo: 'o', icon: Truck },
  lancamento: { label: 'lançamento', artigo: 'o', icon: Banknote },
  procedure: { label: 'procedimento', artigo: 'o', icon: ListChecks },
  prontuario: { label: 'prontuário', artigo: 'o', icon: PenLine },
  appointment: { label: 'atendimento', artigo: 'o', icon: Calendar },
  patient: { label: 'paciente', artigo: 'o', icon: UserRound },
  doctor_availability: { label: 'disponibilidade', artigo: 'a', icon: Calendar },
  clinic_holiday: { label: 'feriado', artigo: 'o', icon: Calendar },
  prescription: { label: 'prescrição', artigo: 'a', icon: FileText },
  document: { label: 'documento', artigo: 'o', icon: FileText },
  financial: { label: 'financeiro', artigo: 'o', icon: Banknote },
  profile: { label: 'acesso', artigo: 'o', icon: ShieldCheck },
  invite: { label: 'convite', artigo: 'o', icon: ShieldCheck },
};

function describe(action: string): { frase: string; Icon: LucideIcon } {
  const segs = action.split('.');
  const last = segs[segs.length - 1] ?? action;
  let entity: (typeof ACT_ENTITIES)[string] | undefined;
  for (let i = segs.length - 2; i >= 0; i--) {
    const e = ACT_ENTITIES[segs[i]!];
    if (e) {
      entity = e;
      break;
    }
  }
  const Icon = entity?.icon ?? CircleDot;
  const alvo = entity
    ? `${entity.artigo} ${entity.label}`
    : (segs[0] ?? '').replace(/_/g, ' ').trim();

  // Verbo desconhecido cai no próprio token do audit: preferimos um rótulo feio
  // e rastreável a inventar uma tradução que não corresponde ao evento.
  const verbo = ACT_VERBS[last] ?? last;
  return { frase: `${verbo} ${alvo}`.trim(), Icon };
}

/**
 * Hora do relógio, não "há 18 h". A referência escreve 13:12 porque o feed é do
 * TURNO: o operador cruza com o que lembra do próprio dia, e "há 18 h" o obriga
 * a fazer a subtração de cabeça. Fora de hoje, a data assume.
 */
function horaOuData(iso: string): string {
  const quando = new Date(iso);
  const mesmoDia = new Date().toDateString() === quando.toDateString();
  return quando.toLocaleString('pt-BR', {
    hourCycle: 'h23',
    ...(mesmoDia ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' }),
  });
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
        const { frase, Icon } = describe(a.action);
        return (
          <li
            key={a.id}
            className="flex items-start gap-2.5 border-b border-border py-3 text-(length:--fs-sm) first:pt-0 last:border-b-0 last:pb-0"
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1 text-pretty text-fg-muted">
              <span className="font-semibold text-fg">{who}</span> {frase}
            </span>
            <span className="shrink-0 font-mono text-(length:--fs-2xs) whitespace-nowrap tabular-nums text-fg-subtle">
              {horaOuData(a.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
