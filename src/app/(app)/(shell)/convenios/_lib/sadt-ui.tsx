'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { todayYmdIn } from '@/lib/format';

import { CARE_TYPES } from './constants';
import {
  checkSadtRequestAction,
  createSadtRequestAction,
  linkAppointmentToSadtItemAction,
  recordSadtAuthorizationAction,
  setSadtClinicalIndicationAction,
  type ActionResult,
} from '@/contexts/health-insurance/actions';

const localToday = () => todayYmdIn();

/** Tabela 50 (tipo de atendimento): os usuais de clínica ambulatorial. */

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    submit: <T,>(fn: () => Promise<ActionResult<T>>, success: string, after?: (data: T) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(success);
        after?.(r.data);
        router.refresh();
      }),
  };
}

type Line = { key: string; code: string; quantity: string };

/** Nova solicitação: a recepção escolhe a carteirinha, o solicitante e os procedimentos do contrato. */
export function NewSadtRequestForm({
  memberships,
  professionals,
  procedures,
}: {
  memberships: Array<{ membershipId: string; patientId: string; label: string }>;
  professionals: Array<{ id: string; name: string }>;
  procedures: Array<{ tableCode: string; procedureCode: string; description: string; insurerName: string }>;
}) {
  const id = useId();
  const router = useRouter();
  const { pending, submit } = useSubmit();
  const [membershipId, setMembershipId] = useState(memberships[0]?.membershipId ?? '');
  const [requesterKind, setRequesterKind] = useState<'internal' | 'external'>('internal');
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? '');
  const [ext, setExt] = useState({ name: '', council: '06', councilNumber: '', councilUf: '35', cbo: '' });
  const [requestedOn, setRequestedOn] = useState(localToday);
  const [careCharacter, setCareCharacter] = useState<'1' | '2'>('1');
  const [careType, setCareType] = useState('03');
  const [lines, setLines] = useState<Line[]>([{ key: 'l1', code: '', quantity: '1' }]);
  const [note, setNote] = useState('');
  if (memberships.length === 0 || procedures.length === 0) {
    return (
      <p className="text-(length:--fs-sm) text-fg-muted">
        Para solicitar, cadastre a carteirinha do paciente e o contrato SP/SADT da operadora.
      </p>
    );
  }
  const card = memberships.find((m) => m.membershipId === membershipId);
  return (
    <form
      className="flex flex-col gap-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        if (!card) return;
        const items = lines
          .filter((l) => l.code)
          .map((l) => {
            const [tableCode, procedureCode] = l.code.split(':') as [string, string];
            return { tableCode, procedureCode, quantity: Number(l.quantity) };
          });
        submit(
          () =>
            createSadtRequestAction({
              membershipId: card.membershipId,
              patientId: card.patientId,
              requester:
                requesterKind === 'internal'
                  ? { kind: 'internal', professionalId }
                  : { kind: 'external', name: ext.name, council: ext.council, councilNumber: ext.councilNumber, councilUf: ext.councilUf, cbo: ext.cbo || null },
              requestedOn,
              careCharacter,
              careType,
              items,
              note: note.trim() || null,
            }),
          'Solicitação registrada',
          (requestId) => router.push(`/convenios/solicitacoes/${requestId}`),
        );
      }}
    >
      <div className="grid gap-(--sp-3) md:grid-cols-2">
        <Field label="Paciente e carteirinha" htmlFor={`${id}-card`} required>
          <Select id={`${id}-card`} value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
            {memberships.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>{m.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Data da solicitação" htmlFor={`${id}-date`} required>
          <Input id={`${id}-date`} type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
        </Field>
        <Field label="Solicitante" htmlFor={`${id}-kind`} required>
          <Select id={`${id}-kind`} value={requesterKind} onChange={(e) => setRequesterKind(e.target.value === 'external' ? 'external' : 'internal')}>
            <option value="internal">Profissional da clínica</option>
            <option value="external">Profissional externo (pedido trazido pelo paciente)</option>
          </Select>
        </Field>
        {requesterKind === 'internal' ? (
          <Field label="Profissional solicitante" htmlFor={`${id}-prof`} required>
            <Select id={`${id}-prof`} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Nome do solicitante externo" htmlFor={`${id}-ext`} required>
            <Input id={`${id}-ext`} value={ext.name} maxLength={70} onChange={(e) => setExt({ ...ext, name: e.target.value })} />
          </Field>
        )}
        {requesterKind === 'external' ? (
          <>
            <Field label="Número no conselho" htmlFor={`${id}-crm`} required>
              <Input id={`${id}-crm`} value={ext.councilNumber} maxLength={15} onChange={(e) => setExt({ ...ext, councilNumber: e.target.value })} />
            </Field>
            <Field label="Conselho e UF (códigos TISS)" htmlFor={`${id}-council`} hint="Ex.: 06 (CRM) e 35 (SP)" required>
              <div className="flex gap-(--sp-2)">
                <Input id={`${id}-council`} value={ext.council} maxLength={2} onChange={(e) => setExt({ ...ext, council: e.target.value })} />
                <Input aria-label="UF do conselho" value={ext.councilUf} maxLength={2} onChange={(e) => setExt({ ...ext, councilUf: e.target.value })} />
              </div>
            </Field>
          </>
        ) : null}
        <Field label="Caráter do atendimento" htmlFor={`${id}-char`} required>
          <Select id={`${id}-char`} value={careCharacter} onChange={(e) => setCareCharacter(e.target.value === '2' ? '2' : '1')}>
            <option value="1">Eletivo</option>
            <option value="2">Urgência ou emergência</option>
          </Select>
        </Field>
        <Field label="Tipo de atendimento" htmlFor={`${id}-type`} required>
          <Select id={`${id}-type`} value={careType} onChange={(e) => setCareType(e.target.value)}>
            {CARE_TYPES.map(([code, label]) => (
              <option key={code} value={code}>{code} — {label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-2)">
        <legend className="px-1 text-(length:--fs-sm) font-medium">Procedimentos (do contrato da operadora)</legend>
        {lines.map((l, i) => (
          <div key={l.key} className="flex flex-wrap items-end gap-(--sp-2)">
            <Field label={`Procedimento ${i + 1}`} htmlFor={`${id}-p${l.key}`}>
              <Select id={`${id}-p${l.key}`} value={l.code} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, code: e.target.value } : x)))}>
                <option value="">Escolha…</option>
                {procedures.map((p) => (
                  <option key={`${p.insurerName}:${p.tableCode}:${p.procedureCode}`} value={`${p.tableCode}:${p.procedureCode}`}>
                    {p.procedureCode} — {p.description} ({p.insurerName})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantidade" htmlFor={`${id}-q${l.key}`}>
              <Input id={`${id}-q${l.key}`} type="number" min={1} max={999} value={l.quantity} className="w-24" onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} />
            </Field>
            {lines.length > 1 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                Remover
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, { key: `l${Date.now()}`, code: '', quantity: '1' }])}>
            Mais um procedimento
          </Button>
        </div>
      </fieldset>
      <Field label="Observação administrativa (opcional)" htmlFor={`${id}-note`} hint="Não escreva dado clínico aqui: a indicação clínica é do profissional solicitante.">
        <Textarea id={`${id}-note`} value={note} rows={2} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending || !lines.some((l) => l.code)}>
          {pending ? 'Aguarde…' : 'Registrar solicitação'}
        </Button>
      </div>
    </form>
  );
}

/** Conferência: confirma o tipo de atendimento e confere contrato e TUSS de cada item. */
export function CheckRequestButton({ requestId, version, careType }: { requestId: string; version: number; careType: string | null }) {
  const { pending, submit } = useSubmit();
  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      disabled={pending}
      onClick={() =>
        submit(() => checkSadtRequestAction({ requestId, version, careType }), 'Conferência registrada', (out) => {
          if (out.startsWith('pendente')) toast.error(out.replace(/^pendente: /u, 'Pendência: '));
        })
      }
    >
      {pending ? 'Aguarde…' : 'Conferir solicitação'}
    </Button>
  );
}

/** Resposta da operadora: quantidade concedida por item e a evidência (número, senha ou protocolo). */
export function AuthorizationForm({
  requestId,
  version,
  items,
}: {
  requestId: string;
  version: number;
  items: Array<{ id: string; label: string; requested: number }>;
}) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(i.requested)])));
  const [f, setF] = useState({ authorizedOn: localToday(), operatorGuideNumber: '', operatorProtocol: '', password: '', passwordValidUntil: '' });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="primary" onClick={() => setOpen(true)}>
        Registrar autorização da operadora
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-3) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          () =>
            recordSadtAuthorizationAction({
              requestId,
              version,
              authorizedOn: f.authorizedOn,
              operatorGuideNumber: f.operatorGuideNumber.trim() || null,
              operatorProtocol: f.operatorProtocol.trim() || null,
              password: f.password.trim() || null,
              passwordValidUntil: f.passwordValidUntil || null,
              items: items.map((i) => ({ requestItemId: i.id, quantityAuthorized: Number(q[i.id] ?? 0) })),
            }),
          'Autorização registrada',
          () => setOpen(false),
        );
      }}
    >
      <p className="text-(length:--fs-sm) text-fg-muted">
        Registre exatamente o que a operadora concedeu. Sem número, senha ou protocolo da operadora, não há autorização.
      </p>
      <div className="grid gap-(--sp-3) md:grid-cols-3">
        <Field label="Data da autorização" htmlFor={`${id}-on`} required>
          <Input id={`${id}-on`} type="date" value={f.authorizedOn} onChange={(e) => setF({ ...f, authorizedOn: e.target.value })} />
        </Field>
        <Field label="Número da guia na operadora" htmlFor={`${id}-num`}>
          <Input id={`${id}-num`} value={f.operatorGuideNumber} maxLength={20} onChange={(e) => setF({ ...f, operatorGuideNumber: e.target.value })} />
        </Field>
        <Field label="Protocolo" htmlFor={`${id}-prot`}>
          <Input id={`${id}-prot`} value={f.operatorProtocol} maxLength={40} onChange={(e) => setF({ ...f, operatorProtocol: e.target.value })} />
        </Field>
        <Field label="Senha" htmlFor={`${id}-pwd`} hint="Guardada cifrada; não aparece de novo na tela.">
          <Input id={`${id}-pwd`} value={f.password} maxLength={20} autoComplete="off" onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Validade da senha" htmlFor={`${id}-val`}>
          <Input id={`${id}-val`} type="date" value={f.passwordValidUntil} onChange={(e) => setF({ ...f, passwordValidUntil: e.target.value })} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-(--sp-2)">
        <legend className="text-(length:--fs-sm) font-medium">Quantidade autorizada por procedimento</legend>
        {items.map((i) => (
          <Field key={i.id} label={`${i.label} (pedido: ${i.requested})`} htmlFor={`${id}-q-${i.id}`}>
            <Input id={`${id}-q-${i.id}`} type="number" min={0} max={999} className="w-24" value={q[i.id] ?? ''} onChange={(e) => setQ({ ...q, [i.id]: e.target.value })} />
          </Field>
        ))}
      </fieldset>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? 'Aguarde…' : 'Confirmar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Indicação clínica: escrita pelo profissional solicitante (ou transcrita do pedido externo). */
export function IndicationForm({ requestId, version, external }: { requestId: string; version: number; external: boolean }) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {external ? 'Transcrever indicação do pedido externo' : 'Informar indicação clínica'}
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => setSadtClinicalIndicationAction({ requestId, version, text }), 'Indicação registrada', () => {
          setOpen(false);
          setText('');
        });
      }}
    >
      <Field
        label="Indicação clínica"
        htmlFor={`${id}-ind`}
        hint={external ? 'Copie só o que está no pedido do profissional externo.' : 'Escrita por você, solicitante. Não é copiada do prontuário e o CID não é exigido.'}
        required
      >
        <Textarea id={`${id}-ind`} value={text} rows={3} maxLength={500} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant="primary" disabled={pending || text.trim().length < 3}>
          {pending ? 'Aguarde…' : 'Confirmar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Liga um atendimento de convênio já agendado ao procedimento que ele vai executar. */
export function LinkSessionForm({
  requestId,
  items,
  appointments,
}: {
  requestId: string;
  items: Array<{ id: string; label: string }>;
  appointments: Array<{ id: string; label: string }>;
}) {
  const id = useId();
  const { pending, submit } = useSubmit();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [appointmentId, setAppointmentId] = useState(appointments[0]?.id ?? '');
  if (items.length === 0) return null;
  if (appointments.length === 0) {
    return <p className="text-(length:--fs-sm) text-fg-muted">Nenhum atendimento de convênio agendado deste paciente sem sessão ligada.</p>;
  }
  return (
    <form
      className="flex flex-wrap items-end gap-(--sp-2)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => linkAppointmentToSadtItemAction({ requestId, itemId, appointmentId }), 'Sessão ligada à solicitação');
      }}
    >
      <Field label="Procedimento" htmlFor={`${id}-item`}>
        <Select id={`${id}-item`} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Atendimento agendado" htmlFor={`${id}-ap`}>
        <Select id={`${id}-ap`} value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
          {appointments.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Aguarde…' : 'Ligar sessão'}
      </Button>
    </form>
  );
}
