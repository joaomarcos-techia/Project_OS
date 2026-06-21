import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/ui/page-header';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { clinicRepository } from '../_lib/repositories/clinics.repo';
import { conversationsRepository } from '../_lib/repositories/conversations.repo';

export const dynamic = 'force-dynamic';

type SP = { clinic?: string; from?: string; to?: string; q?: string; c?: string };

/**
 * Intents canônicos = nomes das tools do agente (gravados em
 * `ai_conversations.intent_atual` = nome da 1ª tool do turno, ver
 * inbound-received.ts). Mantido em sincronia manual com `tools/*`.
 */
const INTENTS: readonly { value: string; label: string }[] = [
  { value: 'schedule_appointment', label: 'Agendar consulta' },
  { value: 'confirm_appointment', label: 'Confirmar consulta' },
  { value: 'cancel_appointment', label: 'Cancelar consulta' },
  { value: 'reschedule_appointment', label: 'Remarcar consulta' },
  { value: 'list_slots', label: 'Listar horários' },
  { value: 'list_pending_payments', label: 'Pagamentos pendentes' },
  { value: 'provide_clinic_info', label: 'Informações da clínica' },
  { value: 'provide_procedure_price', label: 'Preço de procedimento' },
  { value: 'collect_patient_data', label: 'Coletar dados do paciente' },
  { value: 'patient_lookup', label: 'Buscar paciente' },
  { value: 'request_human_handoff', label: 'Falar com humano' },
  { value: 'lgpd_export_request', label: 'LGPD: exportar dados' },
  { value: 'lgpd_delete_request', label: 'LGPD: excluir dados' },
];

function qstring(sp: SP, extra: Partial<SP>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export default async function ConversasIaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const sp = await searchParams;

  const [clinicOptions, conversations, detail] = await Promise.all([
    clinicRepository.listOptions(),
    conversationsRepository.list({
      clinicId: sp.clinic,
      from: sp.from ? `${sp.from}T00:00:00.000Z` : undefined,
      to: sp.to ? `${sp.to}T23:59:59.999Z` : undefined,
      search: sp.q,
      pageSize: 50,
    }),
    sp.c && sp.clinic
      ? conversationsRepository.getDetail(sp.clinic, sp.c)
      : Promise.resolve(null),
  ]);

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Operação <span className="sep">›</span> <b>Conversas IA</b>
          </>
        }
        title="Conversas IA"
        description="Mensagens descriptografadas server-side (o navegador nunca recebe ciphertext)."
      />

      <form className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-50">
          <label className="mb-1 block text-xs text-fg-muted">Clínica</label>
          <select name="clinic" defaultValue={sp.clinic ?? ''} className="select">
            <option value="">Todas</option>
            {clinicOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">De</label>
          <DateField name="from" defaultValue={sp.from ?? ''} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Até</label>
          <DateField name="to" defaultValue={sp.to ?? ''} />
        </div>
        <div className="min-w-50">
          <label className="mb-1 block text-xs text-fg-muted">Intent (atual)</label>
          <select name="q" defaultValue={sp.q ?? ''} className="select">
            <option value="">Todos</option>
            {INTENTS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Filtrar
        </button>
      </form>

      <div className="ia-debug">
        {/* coluna — lista de conversas */}
        <div className="iad-list">
          <div className="iad-filter flex items-center justify-between">
            <b className="text-[13px] font-semibold">Conversas recentes</b>
            <span className="font-mono text-[11px] text-fg-subtle">{conversations.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-4 text-sm text-fg-subtle">Nenhuma conversa.</p>
            ) : (
              conversations.map((conv) => {
                const active = sp.c === conv.id;
                return (
                  <Link
                    key={conv.id}
                    href={`/admin/conversas-ia${qstring(sp, { c: conv.id, clinic: conv.clinicId })}`}
                    className={`iad-item${active ? ' active' : ''}`}
                  >
                    <div className="iad-it-top">
                      <b>{conv.clinicNome}</b>
                      <span className="mono">{conv.messageCount} msg</span>
                    </div>
                    <div className="iad-it-subj">{conv.status}</div>
                    <div className="iad-it-foot">
                      <span className="mono">{formatDateTime(conv.lastMessageAt)}</span>
                      <Badge tone="gray">{conv.status}</Badge>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* coluna — thread */}
        <div className="iad-thread">
          {!detail ? (
            <div className="iad-body items-center justify-center">
              <span className="iad-sys">Selecione uma conversa para ver as mensagens</span>
            </div>
          ) : (
            <>
              <div className="iad-th-head">
                <b>{detail.clinicNome}</b>
                <span className="font-mono text-[11px] text-fg-subtle">
                  {detail.messages.length} mensagem(ns)
                </span>
              </div>
              <div className="iad-body">
                {detail.messages.length === 0 ? (
                  <span className="iad-sys">Sem mensagens.</span>
                ) : (
                  detail.messages.map((m) => (
                    <div key={m.id} className={`iad-msg ${m.direction === 'out' ? 'ai' : 'them'}`}>
                      <div className="iad-bubble whitespace-pre-wrap break-words">{m.text}</div>
                      <span className="iad-mm">
                        {m.direction === 'out' ? 'IA' : 'Paciente'} · {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
