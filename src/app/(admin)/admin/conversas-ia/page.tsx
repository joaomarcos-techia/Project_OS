import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';

import { guardAdminAccess } from '../_lib/guard';
import { formatDateTime } from '../_lib/format';
import { clinicRepository } from '../_lib/repositories/clinics.repo';
import { conversationsRepository } from '../_lib/repositories/conversations.repo';

export const dynamic = 'force-dynamic';

type SP = { clinic?: string; from?: string; to?: string; q?: string; c?: string };

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
    <>
      <PageHeader
        title="Conversas IA"
        description="Mensagens descriptografadas server-side (o navegador nunca recebe ciphertext)."
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
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
          <input type="date" name="from" defaultValue={sp.from ?? ''} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Até</label>
          <input type="date" name="to" defaultValue={sp.to ?? ''} className="input" />
        </div>
        <div className="min-w-50 flex-1">
          <label className="mb-1 block text-xs text-fg-muted">Busca (intent)</label>
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="intent…" />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Filtrar
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversas recentes ({conversations.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nenhuma conversa.</p>
            ) : (
              <div className="divide-y divide-border">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/admin/conversas-ia${qstring(sp, { c: conv.id, clinic: conv.clinicId })}`}
                    className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{conv.clinicNome}</span>
                    <Badge tone="gray">{conv.status}</Badge>
                    <span className="w-12 text-right text-xs text-fg-subtle">{conv.messageCount}</span>
                    <span className="hidden w-32 text-right text-xs text-fg-subtle sm:block">
                      {formatDateTime(conv.lastMessageAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{detail ? `Conversa — ${detail.clinicNome}` : 'Selecione uma conversa'}</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {!detail ? (
              <p className="text-sm text-fg-subtle">
                Clique numa conversa para ver as mensagens (texto já descriptografado).
              </p>
            ) : detail.messages.length === 0 ? (
              <p className="text-sm text-fg-subtle">Sem mensagens.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.direction === 'out'
                        ? 'self-end max-w-[85%] rounded-lg bg-primary-50 px-3 py-2 text-sm dark:bg-primary-950'
                        : 'self-start max-w-[85%] rounded-lg bg-surface-2 px-3 py-2 text-sm'
                    }
                  >
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    <div className="mt-1 text-[10px] text-fg-subtle">
                      {m.direction === 'out' ? 'IA' : 'Paciente'} · {formatDateTime(m.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
