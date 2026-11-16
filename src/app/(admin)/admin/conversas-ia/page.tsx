import Link from 'next/link';
import { z } from 'zod';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/ui/page-header';

import {
  openConversationForAdmin,
  type ConversationOpenResult,
  type MetadataOnlyReason,
} from '../_lib/conversation-content';
import type {
  AiMessageAuthorDTO,
  AiMessageMetaDTO,
  ConversationContentDTO,
  ConversationMetadataDTO,
} from '../_lib/dto';
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
  { value: 'prepare_appointment', label: 'Agendar consulta' },
  // F-12: a tool saiu do catálogo, mas conversas ANTIGAS têm este intent
  // gravado — remover a opção esconderia histórico do filtro.
  { value: 'schedule_appointment', label: 'Agendar consulta (histórico)' },
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

/** Autoria por mensagem: a equipe da clínica não aparece como "IA" (ADR-047). */
const AUTHOR_LABEL: Record<AiMessageAuthorDTO, string> = {
  patient: 'Paciente',
  agent: 'IA',
  human: 'Equipe da clínica',
  business_app: 'Equipe (WhatsApp Business)',
};

const METADATA_NOTICE: Record<MetadataOnlyReason, string> = {
  no_support_session:
    'O texto das mensagens só aparece numa sessão de suporte desta clínica. Cada abertura fica registrada na auditoria da plataforma.',
  other_clinic_session:
    'Sua sessão de suporte é de outra clínica. Para ler esta conversa, encerre-a e abra uma sessão para esta clínica. Cada abertura fica registrada na auditoria da plataforma.',
};

const Uuid = z.string().uuid();

/** UUID ou nada: valor malformado (ou repetido na URL) nunca chega ao SQL. */
function uuidOrUndefined(value: unknown): string | undefined {
  const parsed = Uuid.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function qstring(sp: SP, extra: Partial<SP>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Metadado do turno do agente: ajuda a depurar sem mostrar texto. */
function agentDetails(m: AiMessageMetaDTO): string | null {
  if (m.author !== 'agent') return null;
  const parts = [
    m.intent,
    m.toolNames.length > 0 ? `tools: ${m.toolNames.join(', ')}` : null,
    m.model,
    m.latencyMs !== null ? `${m.latencyMs} ms` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ThreadHead({
  conversation,
}: {
  conversation: { clinicNome: string; messages: unknown[] };
}) {
  return (
    <div className="iad-th-head">
      <b>{conversation.clinicNome}</b>
      <span className="font-mono text-[11px] text-fg-subtle">
        {conversation.messages.length} mensagem(ns)
      </span>
    </div>
  );
}

/** Fora de sessão de suporte da clínica: só metadado, nenhum texto. */
function MetadataThread({
  conversation,
  reason,
}: {
  conversation: ConversationMetadataDTO;
  reason: MetadataOnlyReason;
}) {
  return (
    <>
      <ThreadHead conversation={conversation} />
      <div className="iad-body">
        <Alert role="status" variant="info" title="Só metadados">
          <p>{METADATA_NOTICE[reason]}</p>
          <Link
            prefetch={false}
            href={`/admin/clinicas/${conversation.clinicId}`}
            className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} mt-2`}
          >
            Abrir sessão de suporte
          </Link>
        </Alert>
        {conversation.messages.length === 0 ? (
          <span className="iad-sys">Sem mensagens.</span>
        ) : (
          conversation.messages.map((m) => {
            const details = agentDetails(m);
            return (
              <div
                key={m.id}
                className={`iad-msg ${m.direction === 'out' ? 'ai' : 'them'}`}
                data-message-meta=""
              >
                <span className="iad-mm">
                  {AUTHOR_LABEL[m.author]} · {formatDateTime(m.createdAt)}
                  {details ? ` · ${details}` : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/** Com sessão de suporte da clínica: texto, e a abertura já está registrada. */
function ContentThread({ conversation }: { conversation: ConversationContentDTO }) {
  return (
    <>
      <ThreadHead conversation={conversation} />
      <div className="iad-body">
        <Alert role="status" variant="warning" title="Sessão de suporte ativa">
          Esta abertura foi registrada na auditoria da plataforma.
        </Alert>
        {conversation.messages.length === 0 ? (
          <span className="iad-sys">Sem mensagens.</span>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className={`iad-msg ${m.direction === 'out' ? 'ai' : 'them'}`}>
              <div className="iad-bubble whitespace-pre-wrap break-words">{m.text}</div>
              <span className="iad-mm">
                {AUTHOR_LABEL[m.author]} · {formatDateTime(m.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ConversationPanel({ opened }: { opened: ConversationOpenResult | null }) {
  if (!opened) {
    return (
      <div className="iad-body items-center justify-center">
        <span className="iad-sys">Selecione uma conversa para ver as mensagens</span>
      </div>
    );
  }
  if (opened.kind === 'not_found') {
    return (
      <div className="iad-body items-center justify-center">
        <span className="iad-sys">Conversa não encontrada.</span>
      </div>
    );
  }
  if (opened.kind === 'metadata') {
    return <MetadataThread conversation={opened.conversation} reason={opened.reason} />;
  }
  return <ContentThread conversation={opened.conversation} />;
}

export default async function ConversasIaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdminAccess();
  const sp = await searchParams;

  const clinicId = uuidOrUndefined(sp.clinic);
  const conversationId = uuidOrUndefined(sp.c);
  // Pediu uma conversa com id malformado: "não encontrada", sem tocar no banco.
  const asked = sp.c !== undefined;

  const [clinicOptions, conversations, opened] = await Promise.all([
    clinicRepository.listOptions(),
    conversationsRepository.list({
      clinicId,
      from: sp.from ? `${sp.from}T00:00:00.000Z` : undefined,
      to: sp.to ? `${sp.to}T23:59:59.999Z` : undefined,
      search: sp.q,
      pageSize: 50,
    }),
    clinicId && conversationId
      ? openConversationForAdmin(clinicId, conversationId)
      : Promise.resolve<ConversationOpenResult | null>(asked ? { kind: 'not_found' } : null),
  ]);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Conversas IA' }]}
        title="Conversas IA"
        description="Metadados das conversas de todas as clínicas. O texto só aparece numa sessão de suporte da clínica, e cada abertura fica registrada."
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
                const active = conversationId === conv.id;
                return (
                  // prefetch desligado: abrir conversa é ato explícito, nunca
                  // efeito de o link entrar na tela (ADR-073).
                  <Link
                    key={conv.id}
                    prefetch={false}
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
          <ConversationPanel opened={opened} />
        </div>
      </div>
    </div>
  );
}
