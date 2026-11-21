'use client';

/**
 * Formulários da configuração de Convênios (P2.6, P3.1; R44). Só componentes: as
 * constantes compartilhadas ficam em `constants.ts` (fronteira servidor/cliente, R46).
 * Toda regra é conferida de novo no servidor e no banco; aqui é só a interação.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { todayYmdIn } from '@/lib/format';
import {
  createContractLineAction,
  createCredentialAction,
  createInsurerAction,
  createMembershipAction,
  createPlanAction,
  listSchedulingCardsAction,
  recordAppointmentCoverageAction,
  replaceMembershipAction,
  revealMembershipNumberAction,
  reviseContractLineAction,
  reviseCredentialAction,
  saveProfessionalProfileAction,
  saveInsurerRulesAction,
  saveProviderIdentityAction,
  searchOfficialTermsAction,
  setInsurerStatusAction,
  setMembershipActiveAction,
  setPlanStatusAction,
  setPreferredMembershipAction,
  updateInsurerAction,
  updateMembershipAction,
  type ConfigResult,
} from '@/contexts/health-insurance/config-actions';
import type {
  ContractLineView,
  InsurerDetail,
  MembershipView,
  SchedulingCard,
} from '@/contexts/health-insurance/config-queries';

import { toCents } from './batch-ui';

type Run = (
  fn: () => Promise<ConfigResult<unknown>>,
  success: string,
  after?: (data: unknown) => void,
) => void;

function useRun(): { pending: boolean; run: Run } {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run: Run = (fn, success, after) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        after?.(r.data);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  return { pending, run };
}

const cents = (v: string): number | null => {
  const c = toCents(v);
  return c === null || Number.isNaN(c) ? null : c;
};
const brlInput = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

function Box({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="flex w-full flex-col gap-(--sp-3) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function Toggle({
  label,
  children,
  variant = 'secondary',
}: {
  label: string;
  children: (close: () => void) => ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return <>{children(() => setOpen(false))}</>;
}

function Actions({
  pending,
  onCancel,
  submit = 'Salvar',
}: {
  pending: boolean;
  onCancel?: () => void;
  submit?: string;
}) {
  return (
    <div className="flex flex-wrap gap-(--sp-2)">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Aguarde…' : submit}
      </Button>
      {onCancel ? (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      ) : null}
    </div>
  );
}

// ── Identificação do prestador ───────────────────────────────────────────

export function ProviderIdentityForm({
  initial,
}: {
  initial: {
    providerKind: 'PF' | 'PJ' | null;
    contractorName: string | null;
    cnesStatus: 'unknown' | 'has' | 'none_declared';
    cnes: string | null;
  };
}) {
  const id = useId();
  const [providerKind, setKind] = useState<'PF' | 'PJ' | ''>(initial.providerKind ?? '');
  const [contractorName, setName] = useState(initial.contractorName ?? '');
  const [cnesStatus, setCnesStatus] = useState(
    initial.cnesStatus === 'unknown' ? '' : initial.cnesStatus,
  );
  const [cnes, setCnes] = useState(initial.cnes ?? '');
  const { pending, run } = useRun();
  return (
    <Box
      onSubmit={() => {
        if (!providerKind)
          return toast.error('Escolha se a clínica fatura como pessoa jurídica ou física.');
        if (!cnesStatus) return toast.error('Informe o CNES ou declare que a clínica não tem.');
        run(
          () =>
            saveProviderIdentityAction({
              providerKind,
              contractorName,
              cnesStatus: cnesStatus as 'has' | 'none_declared',
              cnes: cnesStatus === 'has' ? cnes : null,
            }),
          'Identificação do prestador salva.',
        );
      }}
    >
      <div className="grid gap-(--sp-3) sm:grid-cols-2">
        <Field label="Fatura como" htmlFor={`${id}-kind`} required>
          <Select
            id={`${id}-kind`}
            value={providerKind}
            onChange={(e) => setKind(e.target.value as 'PF' | 'PJ' | '')}
          >
            <option value="">Selecione…</option>
            <option value="PJ">Pessoa jurídica (clínica)</option>
            <option value="PF">Pessoa física (profissional)</option>
          </Select>
        </Field>
        <Field
          label="Nome do contratado"
          htmlFor={`${id}-name`}
          hint="Como consta no contrato com as operadoras (até 70 caracteres)."
          required
        >
          <Input
            id={`${id}-name`}
            value={contractorName}
            maxLength={70}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="CNES" htmlFor={`${id}-cnes-status`} required>
          <Select
            id={`${id}-cnes-status`}
            value={cnesStatus}
            onChange={(e) => setCnesStatus(e.target.value as 'has' | 'none_declared' | '')}
          >
            <option value="">Selecione…</option>
            <option value="has">A clínica tem CNES</option>
            <option value="none_declared">Declaro que a clínica não tem CNES</option>
          </Select>
        </Field>
        {cnesStatus === 'has' ? (
          <Field label="Número do CNES" htmlFor={`${id}-cnes`} hint="7 dígitos." required>
            <Input
              id={`${id}-cnes`}
              value={cnes}
              inputMode="numeric"
              maxLength={7}
              onChange={(e) => setCnes(e.target.value)}
            />
          </Field>
        ) : null}
      </div>
      {cnesStatus === 'none_declared' ? (
        <p className="text-(length:--fs-xs) text-fg-muted">
          Sem CNES, a guia leva o código de ausência do padrão TISS (9999999), como a ANS prevê para
          quem declara não ter.
        </p>
      ) : null}
      <Actions pending={pending} />
    </Box>
  );
}

// ── Operadora ────────────────────────────────────────────────────────────

type ProviderKind = 'codigoPrestadorNaOperadora' | 'cnpjContratado' | 'cpfContratado';

function InsurerFields({
  id,
  v,
  set,
  ansLocked,
  providerHint,
}: {
  id: string;
  v: {
    name: string;
    registroAns: string;
    providerIdKind: ProviderKind;
    providerIdValue: string;
    sadtGrouping: 'per_session' | 'per_request';
  };
  set: (patch: Partial<typeof v>) => void;
  ansLocked?: boolean;
  providerHint?: string;
}) {
  return (
    <div className="grid gap-(--sp-3) sm:grid-cols-2">
      <Field label="Nome da operadora" htmlFor={`${id}-name`} required>
        <Input
          id={`${id}-name`}
          value={v.name}
          maxLength={120}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <Field
        label="Registro ANS"
        htmlFor={`${id}-ans`}
        hint={
          ansLocked
            ? 'Só muda enquanto a operadora está em rascunho.'
            : '6 dígitos, como no contrato ou no cadastro da ANS.'
        }
        required
      >
        <Input
          id={`${id}-ans`}
          value={v.registroAns}
          inputMode="numeric"
          maxLength={6}
          disabled={ansLocked}
          onChange={(e) => set({ registroAns: e.target.value })}
        />
      </Field>
      <Field label="Identificação do prestador na operadora" htmlFor={`${id}-pkind`} required>
        <Select
          id={`${id}-pkind`}
          value={v.providerIdKind}
          onChange={(e) => set({ providerIdKind: e.target.value as ProviderKind })}
        >
          <option value="codigoPrestadorNaOperadora">Código do prestador na operadora</option>
          <option value="cnpjContratado">CNPJ do contratado</option>
          <option value="cpfContratado">CPF do contratado</option>
        </Select>
      </Field>
      <Field
        label={
          v.providerIdKind === 'cnpjContratado'
            ? 'CNPJ'
            : v.providerIdKind === 'cpfContratado'
              ? 'CPF'
              : 'Código do prestador'
        }
        htmlFor={`${id}-pvalue`}
        {...(providerHint ? { hint: providerHint } : {})}
        required
      >
        <Input
          id={`${id}-pvalue`}
          value={v.providerIdValue}
          maxLength={18}
          onChange={(e) => set({ providerIdValue: e.target.value })}
        />
      </Field>
      <Field
        label="Sessões SP/SADT"
        htmlFor={`${id}-group`}
        hint="Regra da operadora para guias de sessões."
      >
        <Select
          id={`${id}-group`}
          value={v.sadtGrouping}
          onChange={(e) =>
            set({ sadtGrouping: e.target.value === 'per_request' ? 'per_request' : 'per_session' })
          }
        >
          <option value="per_session">Uma guia por sessão</option>
          <option value="per_request">Sessões da mesma solicitação na mesma guia</option>
        </Select>
      </Field>
    </div>
  );
}

export function NewInsurerForm() {
  const id = useId();
  const router = useRouter();
  const [v, setV] = useState({
    name: '',
    registroAns: '',
    providerIdKind: 'codigoPrestadorNaOperadora' as ProviderKind,
    providerIdValue: '',
    sadtGrouping: 'per_session' as 'per_session' | 'per_request',
  });
  const { pending, run } = useRun();
  return (
    <Toggle label="Nova operadora" variant="primary">
      {(close) => (
        <Box
          onSubmit={() =>
            run(
              () => createInsurerAction(v),
              'Operadora cadastrada em rascunho.',
              (insurerId) => router.push(`/convenios/configuracao/operadoras/${String(insurerId)}`),
            )
          }
        >
          <InsurerFields id={id} v={v} set={(p) => setV((cur) => ({ ...cur, ...p }))} />
          <p className="text-(length:--fs-xs) text-fg-muted">
            A operadora nasce em rascunho. Confira os dados, cadastre os procedimentos contratados e
            ative-a para usar no agendamento.
          </p>
          <Actions pending={pending} onCancel={close} submit="Cadastrar" />
        </Box>
      )}
    </Toggle>
  );
}

export function InsurerEditForm({ insurer }: { insurer: InsurerDetail['insurer'] }) {
  const id = useId();
  const [v, setV] = useState({
    name: insurer.name,
    registroAns: insurer.registroAns,
    providerIdKind: insurer.providerIdKind as ProviderKind,
    providerIdValue: insurer.providerIdEditable ?? '',
    sadtGrouping: insurer.sadtGrouping,
  });
  const { pending, run } = useRun();
  return (
    <Toggle label="Editar dados">
      {(close) => (
        <Box
          onSubmit={() =>
            run(
              () => updateInsurerAction({ ...v, insurerId: insurer.id }),
              'Dados da operadora atualizados.',
              close,
            )
          }
        >
          <InsurerFields
            id={id}
            v={v}
            set={(p) => setV((cur) => ({ ...cur, ...p }))}
            ansLocked={insurer.status !== 'draft'}
            {...(insurer.providerIdKind === 'cpfContratado'
              ? {
                  providerHint: 'Por segurança o CPF não é mostrado: digite-o de novo para salvar.',
                }
              : {})}
          />
          <Actions pending={pending} onCancel={close} />
        </Box>
      )}
    </Toggle>
  );
}

const STATUS_ACTIONS: Record<
  string,
  Array<{ to: 'active' | 'suspended' | 'archived'; label: string; confirm?: string }>
> = {
  draft: [
    { to: 'active', label: 'Ativar operadora' },
    {
      to: 'archived',
      label: 'Arquivar',
      confirm: 'Arquivar o rascunho? Ele pode ser reativado depois.',
    },
  ],
  active: [
    {
      to: 'suspended',
      label: 'Suspender',
      confirm:
        'Suspender a operadora? Ela some do agendamento; guias, contratos e carteirinhas ficam.',
    },
    {
      to: 'archived',
      label: 'Arquivar',
      confirm:
        'Arquivar a operadora? Nada é apagado; ela some do agendamento e dos cadastros novos.',
    },
  ],
  suspended: [
    { to: 'active', label: 'Reativar' },
    { to: 'archived', label: 'Arquivar', confirm: 'Arquivar a operadora? Nada é apagado.' },
  ],
  archived: [{ to: 'active', label: 'Reativar' }],
};

export function InsurerStatusActions({ insurerId, status }: { insurerId: string; status: string }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const { pending, run } = useRun();
  const actions = STATUS_ACTIONS[status] ?? [];
  return (
    <div className="flex flex-wrap items-center gap-(--sp-2)">
      {actions.map((a) =>
        confirming === a.to ? (
          <div
            key={a.to}
            className="flex flex-wrap items-center gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-2)"
          >
            <span className="text-(length:--fs-sm)">{a.confirm}</span>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () => setInsurerStatusAction({ insurerId, status: a.to }),
                  'Situação da operadora atualizada.',
                  () => setConfirming(null),
                )
              }
            >
              Confirmar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Voltar
            </Button>
          </div>
        ) : (
          <Button
            key={a.to}
            type="button"
            size="sm"
            variant={a.to === 'active' ? 'primary' : 'secondary'}
            disabled={pending}
            onClick={() =>
              a.confirm
                ? setConfirming(a.to)
                : run(
                    () => setInsurerStatusAction({ insurerId, status: a.to }),
                    'Situação da operadora atualizada.',
                  )
            }
          >
            {a.label}
          </Button>
        ),
      )}
    </div>
  );
}

// ── Planos ───────────────────────────────────────────────────────────────

export function NewPlanForm({ insurerId }: { insurerId: string }) {
  const id = useId();
  const [name, setName] = useState('');
  const [operatorCode, setCode] = useState('');
  const [category, setCategory] = useState('');
  const { pending, run } = useRun();
  return (
    <Toggle label="Novo plano">
      {(close) => (
        <Box
          onSubmit={() =>
            run(
              () =>
                createPlanAction({
                  insurerId,
                  name,
                  operatorCode: operatorCode || null,
                  category: (category || null) as
                    | 'ambulatorial'
                    | 'hospitalar'
                    | 'referencia'
                    | 'outro'
                    | null,
                }),
              'Plano cadastrado.',
              () => {
                setName('');
                setCode('');
                close();
              },
            )
          }
        >
          <div className="grid gap-(--sp-3) sm:grid-cols-3">
            <Field label="Nome do plano" htmlFor={`${id}-name`} required>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Código na operadora (opcional)" htmlFor={`${id}-code`}>
              <Input
                id={`${id}-code`}
                value={operatorCode}
                maxLength={40}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="Segmentação (opcional)" htmlFor={`${id}-cat`}>
              <Select
                id={`${id}-cat`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Não informada</option>
                <option value="ambulatorial">Ambulatorial</option>
                <option value="hospitalar">Hospitalar</option>
                <option value="referencia">Referência</option>
                <option value="outro">Outra</option>
              </Select>
            </Field>
          </div>
          <Actions pending={pending} onCancel={close} submit="Cadastrar plano" />
        </Box>
      )}
    </Toggle>
  );
}

export function PlanStatusButton({ planId, status }: { planId: string; status: string }) {
  const { pending, run } = useRun();
  const to = status === 'active' ? 'archived' : 'active';
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        run(
          () => setPlanStatusAction({ planId, status: to }),
          to === 'archived' ? 'Plano arquivado.' : 'Plano reativado.',
        )
      }
    >
      {to === 'archived' ? 'Arquivar' : 'Reativar'}
    </Button>
  );
}

// ── Busca de termos oficiais (TUSS 22 / CBO 24) ──────────────────────────

function TermPicker({
  id,
  table,
  label,
  hint,
  value,
  onPick,
}: {
  id: string;
  table: '22' | '24';
  label: string;
  hint: string;
  value: { code: string; term: string } | null;
  onPick: (t: { code: string; term: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Array<{ code: string; term: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      void searchOfficialTermsAction({ table, term: q }).then((r) => {
        if (!alive) return;
        setBusy(false);
        setHits(r.ok ? r.data : []);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, table]);
  if (value) {
    return (
      <Field label={label} htmlFor={`${id}-picked`} required>
        <div
          id={`${id}-picked`}
          className="flex flex-wrap items-center gap-(--sp-2) text-(length:--fs-sm)"
        >
          <span className="font-medium tabular-nums">{value.code}</span>
          <span className="text-fg-muted">{value.term}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
            Trocar
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={`${id}-q`} hint={hint} required>
      <Input
        id={`${id}-q`}
        value={q}
        placeholder="Código ou parte do nome"
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      {busy ? <p className="text-(length:--fs-xs) text-fg-muted">Buscando…</p> : null}
      {hits.length > 0 ? (
        <ul
          className="mt-1 max-h-56 overflow-y-auto rounded-(--r-md) border border-border"
          role="listbox"
          aria-label={`Resultados da tabela ${table}`}
        >
          {hits.map((h) => (
            <li key={h.code}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full gap-(--sp-2) px-(--sp-2) py-1 text-left text-(length:--fs-sm) hover:bg-surface-2"
                onClick={() => {
                  onPick(h);
                  setQ('');
                  setHits([]);
                }}
              >
                <span className="tabular-nums font-medium">{h.code}</span>
                <span>{h.term}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && !busy ? (
        <p className="text-(length:--fs-xs) text-fg-muted">
          Nada encontrado na tabela {table} carregada.
        </p>
      ) : null}
    </Field>
  );
}

// ── Contrato ─────────────────────────────────────────────────────────────

interface TermsState {
  value: string;
  requiresAuthorization: boolean;
  copayKind: 'none' | 'fixed' | 'percentage';
  copayFixed: string;
  copayPercentage: string;
  returnDays: string;
  returnBillable: boolean;
}

function termsFromLine(l?: ContractLineView): TermsState {
  return {
    value: l && l.unitValueCents !== null ? brlInput(l.unitValueCents) : '',
    requiresAuthorization: l?.requiresAuthorization ?? false,
    copayKind: l?.copayKind ?? 'none',
    copayFixed: l ? brlInput(l.copayFixedCents) : '',
    copayPercentage:
      l?.copayPercentage !== null && l?.copayPercentage !== undefined
        ? String(l.copayPercentage).replace('.', ',')
        : '',
    returnDays: l?.returnDays ? String(l.returnDays) : '',
    returnBillable: l?.returnBillable ?? false,
  };
}

/** Converte o formulário para o contrato; `string` = mensagem de erro para a pessoa. */
function termsPayload(t: TermsState) {
  const unitValueCents = cents(t.value);
  if (unitValueCents === null) return 'Informe o valor contratado (R$).';
  let copayFixedCents: number | null = null;
  let copayPercentage: number | null = null;
  if (t.copayKind === 'fixed') {
    copayFixedCents = cents(t.copayFixed);
    if (copayFixedCents === null) return 'Informe o valor fixo da coparticipação (R$).';
  }
  if (t.copayKind === 'percentage') {
    copayPercentage = Number(t.copayPercentage.replace(',', '.'));
    if (!(copayPercentage > 0)) return 'Informe o percentual da coparticipação.';
  }
  const returnDays = t.returnDays.trim() ? Number(t.returnDays) : null;
  return {
    unitValueCents,
    requiresAuthorization: t.requiresAuthorization,
    copayKind: t.copayKind,
    copayFixedCents,
    copayPercentage,
    returnDays,
    returnBillable: t.returnBillable,
  };
}

function TermsFields({
  id,
  t,
  set,
  guideType,
}: {
  id: string;
  t: TermsState;
  set: (p: Partial<TermsState>) => void;
  guideType: 'consulta' | 'sp_sadt';
}) {
  return (
    <>
      <div className="grid gap-(--sp-3) sm:grid-cols-3">
        <Field label="Valor contratado (R$)" htmlFor={`${id}-value`} required>
          <Input
            id={`${id}-value`}
            value={t.value}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => set({ value: e.target.value })}
          />
        </Field>
        <Field label="Coparticipação" htmlFor={`${id}-copay`}>
          <Select
            id={`${id}-copay`}
            value={t.copayKind}
            onChange={(e) => set({ copayKind: e.target.value as TermsState['copayKind'] })}
          >
            <option value="none">Não há</option>
            <option value="fixed">Valor fixo</option>
            <option value="percentage">Percentual</option>
          </Select>
        </Field>
        {t.copayKind === 'fixed' ? (
          <Field
            label="Coparticipação (R$)"
            htmlFor={`${id}-cfix`}
            hint="Nunca acima do valor contratado."
            required
          >
            <Input
              id={`${id}-cfix`}
              value={t.copayFixed}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => set({ copayFixed: e.target.value })}
            />
          </Field>
        ) : t.copayKind === 'percentage' ? (
          <Field
            label="Coparticipação (%)"
            htmlFor={`${id}-cpct`}
            hint="De 0,01 a 100, com até 2 casas."
            required
          >
            <Input
              id={`${id}-cpct`}
              value={t.copayPercentage}
              inputMode="decimal"
              onChange={(e) => set({ copayPercentage: e.target.value })}
            />
          </Field>
        ) : null}
      </div>
      <div className="grid gap-(--sp-3) sm:grid-cols-3">
        <label className="flex items-center gap-2 text-(length:--fs-sm)">
          <Checkbox
            checked={t.requiresAuthorization}
            onCheckedChange={(c) => set({ requiresAuthorization: c === true })}
          />
          Exige autorização prévia da operadora
        </label>
        {guideType === 'consulta' ? (
          <>
            <Field label="Prazo de retorno (dias, opcional)" htmlFor={`${id}-ret`}>
              <Input
                id={`${id}-ret`}
                value={t.returnDays}
                inputMode="numeric"
                maxLength={3}
                onChange={(e) => set({ returnDays: e.target.value })}
              />
            </Field>
            {t.returnDays.trim() ? (
              <label className="flex items-center gap-2 text-(length:--fs-sm)">
                <Checkbox
                  checked={t.returnBillable}
                  onCheckedChange={(c) => set({ returnBillable: c === true })}
                />
                Retorno dentro do prazo é faturável
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

export function NewContractLineForm({
  insurerId,
  plans,
  procedures,
}: {
  insurerId: string;
  plans: InsurerDetail['plans'];
  procedures: InsurerDetail['procedures'];
}) {
  const id = useId();
  const [guideType, setGuideType] = useState<'consulta' | 'sp_sadt'>('consulta');
  const [planId, setPlanId] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [tuss, setTuss] = useState<{ code: string; term: string } | null>(null);
  const [description, setDescription] = useState('');
  const [validFrom, setFrom] = useState(() => todayYmdIn());
  const [validUntil, setUntil] = useState('');
  const [t, setT] = useState<TermsState>(termsFromLine());
  const { pending, run } = useRun();
  const activePlans = plans.filter((p) => p.status === 'active');
  return (
    <Toggle label="Novo procedimento contratado" variant="primary">
      {(close) => (
        <Box
          onSubmit={() => {
            if (!procedureId) return toast.error('Escolha o procedimento do catálogo da clínica.');
            if (!tuss) return toast.error('Escolha o código TUSS na tabela oficial.');
            const terms = termsPayload(t);
            if (typeof terms === 'string') return toast.error(terms);
            run(
              () =>
                createContractLineAction({
                  insurerId,
                  planId: planId || null,
                  guideType,
                  procedureCode: tuss.code,
                  description: description.trim() || null,
                  procedureId,
                  validFrom,
                  validUntil: validUntil || null,
                  ...terms,
                }),
              'Procedimento contratado cadastrado.',
              () => {
                setTuss(null);
                setProcedureId('');
                setT(termsFromLine());
                close();
              },
            );
          }}
        >
          {procedures.length === 0 ? (
            <Alert variant="warning">
              Cadastre antes o procedimento no catálogo da clínica (Configurações › Procedimentos);
              o agendamento usa o catálogo.
            </Alert>
          ) : null}
          <div className="grid gap-(--sp-3) sm:grid-cols-3">
            <Field label="Tipo de guia" htmlFor={`${id}-gt`} required>
              <Select
                id={`${id}-gt`}
                value={guideType}
                onChange={(e) =>
                  setGuideType(e.target.value === 'sp_sadt' ? 'sp_sadt' : 'consulta')
                }
              >
                <option value="consulta">Consulta</option>
                <option value="sp_sadt">SP/SADT</option>
              </Select>
            </Field>
            <Field
              label="Plano"
              htmlFor={`${id}-plan`}
              hint="Em branco = vale para todos os planos da operadora."
            >
              <Select id={`${id}-plan`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Todos os planos</option>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Procedimento do catálogo" htmlFor={`${id}-proc`} required>
              <Select
                id={`${id}-proc`}
                value={procedureId}
                onChange={(e) => setProcedureId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.descricao}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <TermPicker
            id={`${id}-tuss`}
            table="22"
            label="Código TUSS (tabela 22)"
            hint="Busque pelo código ou pelo nome na terminologia oficial carregada."
            value={tuss}
            onPick={setTuss}
          />
          <Field
            label="Descrição na guia (opcional)"
            htmlFor={`${id}-desc`}
            hint="Em branco = a descrição oficial da TUSS."
          >
            <Input
              id={`${id}-desc`}
              value={description}
              maxLength={150}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            <Field label="Início da vigência" htmlFor={`${id}-from`} required>
              <Input
                id={`${id}-from`}
                type="date"
                value={validFrom}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="Fim da vigência (opcional)" htmlFor={`${id}-until`}>
              <Input
                id={`${id}-until`}
                type="date"
                value={validUntil}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </div>
          <TermsFields
            id={id}
            t={t}
            set={(p) => setT((cur) => ({ ...cur, ...p }))}
            guideType={guideType}
          />
          <Actions pending={pending} onCancel={close} submit="Cadastrar procedimento" />
        </Box>
      )}
    </Toggle>
  );
}

export function ContractRevisionForm({
  line,
  procedures,
}: {
  line: ContractLineView;
  procedures: InsurerDetail['procedures'];
}) {
  const id = useId();
  const [mode, setMode] = useState<'new_period' | 'correct' | 'end'>('new_period');
  const [date, setDate] = useState(() => todayYmdIn());
  const [reason, setReason] = useState('');
  const [procedureId, setProcedureId] = useState(line.procedureId ?? '');
  const [t, setT] = useState<TermsState>(termsFromLine(line));
  const { pending, run } = useRun();
  return (
    <Toggle label="Alterar">
      {(close) => (
        <Box
          onSubmit={() => {
            const terms = mode === 'end' ? null : termsPayload(t);
            if (typeof terms === 'string') return toast.error(terms);
            const revision =
              mode === 'end'
                ? { mode, until: date, reason }
                : mode === 'new_period'
                  ? { mode, from: date, terms: terms!, reason }
                  : {
                      mode,
                      terms: terms!,
                      description: null,
                      procedureId: procedureId || line.procedureId || '',
                      reason,
                    };
            run(
              () => reviseContractLineAction({ lineId: line.id, revision }),
              'Contrato atualizado; a versão anterior ficou no histórico.',
              close,
            );
          }}
        >
          <Field label="O que mudou" htmlFor={`${id}-mode`}>
            <Select
              id={`${id}-mode`}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="new_period">
                Reajuste a partir de uma data (o passado mantém o valor antigo)
              </option>
              <option value="correct">Corrigir este item desde o início (erro de cadastro)</option>
              <option value="end">Encerrar a vigência</option>
            </Select>
          </Field>
          {mode !== 'correct' ? (
            <Field
              label={mode === 'end' ? 'Último dia de vigência' : 'Vale a partir de'}
              htmlFor={`${id}-date`}
              required
            >
              <Input
                id={`${id}-date`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Procedimento do catálogo" htmlFor={`${id}-proc`}>
              <Select
                id={`${id}-proc`}
                value={procedureId}
                onChange={(e) => setProcedureId(e.target.value)}
              >
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.descricao}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode !== 'end' ? (
            <TermsFields
              id={id}
              t={t}
              set={(p) => setT((cur) => ({ ...cur, ...p }))}
              guideType={line.guideType}
            />
          ) : null}
          {mode === 'correct' ? (
            <Alert variant="info">
              A correção vale para atendimentos que ainda não têm guia emitida. Guia emitida nunca
              muda.
            </Alert>
          ) : null}
          <Field
            label="Motivo"
            htmlFor={`${id}-reason`}
            hint="Fica no histórico do contrato (10 a 500 caracteres)."
            required
          >
            <Textarea
              id={`${id}-reason`}
              value={reason}
              rows={2}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Actions
            pending={pending || reason.trim().length < 10}
            onCancel={close}
            submit="Salvar nova versão"
          />
        </Box>
      )}
    </Toggle>
  );
}

// ── Perfil TISS do profissional ──────────────────────────────────────────

export function ProfessionalProfileForm({
  professional,
  councils,
  ufs,
}: {
  professional: {
    id: string;
    nome: string;
    profile: {
      council: string;
      councilNumber: string;
      councilUf: string;
      cbo: string;
      cboTerm: string | null;
    } | null;
  };
  councils: Array<{ code: string; term: string }>;
  ufs: Array<{ code: string; term: string; sigla: string | null }>;
}) {
  const id = useId();
  const p = professional.profile;
  const [council, setCouncil] = useState(p?.council ?? '');
  const [councilNumber, setNumber] = useState(p?.councilNumber ?? '');
  const [councilUf, setUf] = useState(p?.councilUf ?? '');
  const [cbo, setCbo] = useState<{ code: string; term: string } | null>(
    p ? { code: p.cbo, term: p.cboTerm ?? '' } : null,
  );
  const { pending, run } = useRun();
  return (
    <Toggle
      label={p ? 'Editar perfil TISS' : 'Cadastrar perfil TISS'}
      variant={p ? 'secondary' : 'primary'}
    >
      {(close) => (
        <Box
          onSubmit={() => {
            if (!cbo) return toast.error('Escolha o CBO na tabela oficial.');
            run(
              () =>
                saveProfessionalProfileAction({
                  professionalId: professional.id,
                  council,
                  councilNumber,
                  councilUf,
                  cbo: cbo.code,
                }),
              `Perfil TISS de ${professional.nome} salvo.`,
              close,
            );
          }}
        >
          <div className="grid gap-(--sp-3) sm:grid-cols-3">
            <Field label="Conselho profissional" htmlFor={`${id}-council`} required>
              <Select
                id={`${id}-council`}
                value={council}
                onChange={(e) => setCouncil(e.target.value)}
              >
                <option value="">Selecione…</option>
                {councils.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.term}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Número no conselho" htmlFor={`${id}-num`} required>
              <Input
                id={`${id}-num`}
                value={councilNumber}
                maxLength={15}
                onChange={(e) => setNumber(e.target.value)}
              />
            </Field>
            <Field label="UF do conselho" htmlFor={`${id}-uf`} required>
              <Select id={`${id}-uf`} value={councilUf} onChange={(e) => setUf(e.target.value)}>
                <option value="">Selecione…</option>
                {ufs.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.sigla ? `${u.sigla} — ${u.term}` : u.term}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <TermPicker
            id={`${id}-cbo`}
            table="24"
            label="CBO (tabela 24)"
            hint="Especialidade do profissional na Classificação Brasileira de Ocupações."
            value={cbo}
            onPick={setCbo}
          />
          <Actions pending={pending} onCancel={close} />
        </Box>
      )}
    </Toggle>
  );
}

// ── Carteirinhas ─────────────────────────────────────────────────────────

type InsurerOption = {
  id: string;
  name: string;
  status: string;
  plans: Array<{ id: string; name: string }>;
};

export function NewMembershipForm({
  patientId,
  insurers,
}: {
  patientId: string;
  insurers: InsurerOption[];
}) {
  const id = useId();
  const [insurerId, setInsurerId] = useState(insurers.length === 1 ? insurers[0]!.id : '');
  const [planId, setPlanId] = useState('');
  const [cardNumber, setNumber] = useState('');
  const [holderKind, setHolder] = useState<'titular' | 'dependente'>('titular');
  const [validUntil, setValid] = useState('');
  const [preferred, setPreferred] = useState(true);
  const { pending, run } = useRun();
  const plans = insurers.find((i) => i.id === insurerId)?.plans ?? [];
  if (insurers.length === 0) {
    return (
      <Alert variant="warning">
        Nenhuma operadora cadastrada. Cadastre a operadora em Convênios › Configuração antes da
        carteirinha.
      </Alert>
    );
  }
  return (
    <Toggle label="Nova carteirinha" variant="primary">
      {(close) => (
        <Box
          onSubmit={() => {
            if (!insurerId) return toast.error('Escolha a operadora.');
            run(
              () =>
                createMembershipAction({
                  patientId,
                  insurerId,
                  planId: planId || null,
                  cardNumber,
                  holderKind,
                  validUntil: validUntil || null,
                  preferred,
                }),
              'Carteirinha cadastrada.',
              () => {
                setNumber('');
                close();
              },
            );
          }}
        >
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            <Field label="Operadora" htmlFor={`${id}-ins`} required>
              <Select
                id={`${id}-ins`}
                value={insurerId}
                onChange={(e) => {
                  setInsurerId(e.target.value);
                  setPlanId('');
                }}
              >
                <option value="">Selecione…</option>
                {insurers.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.status !== 'active' ? ' (não ativa)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Plano (opcional)" htmlFor={`${id}-plan`}>
              <Select
                id={`${id}-plan`}
                value={planId}
                disabled={plans.length === 0}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">
                  {plans.length === 0 ? 'Operadora sem planos cadastrados' : 'Não informado'}
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Número da carteirinha"
              htmlFor={`${id}-num`}
              hint="Guardado cifrado; depois aparece só o final."
              required
            >
              <Input
                id={`${id}-num`}
                value={cardNumber}
                maxLength={30}
                autoComplete="off"
                onChange={(e) => setNumber(e.target.value)}
              />
            </Field>
            <Field label="Validade (opcional)" htmlFor={`${id}-valid`}>
              <Input
                id={`${id}-valid`}
                type="date"
                value={validUntil}
                onChange={(e) => setValid(e.target.value)}
              />
            </Field>
            <Field label="Titularidade" htmlFor={`${id}-holder`}>
              <Select
                id={`${id}-holder`}
                value={holderKind}
                onChange={(e) =>
                  setHolder(e.target.value === 'dependente' ? 'dependente' : 'titular')
                }
              >
                <option value="titular">Titular</option>
                <option value="dependente">Dependente</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end text-(length:--fs-sm)">
              <Checkbox checked={preferred} onCheckedChange={(c) => setPreferred(c === true)} />
              Carteirinha preferencial do paciente
            </label>
          </div>
          <Actions pending={pending} onCancel={close} submit="Cadastrar carteirinha" />
        </Box>
      )}
    </Toggle>
  );
}

export function MembershipActions({
  card,
  insurer,
}: {
  card: MembershipView;
  insurer: InsurerOption | undefined;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'edit' | 'replace'>('none');
  const [planId, setPlanId] = useState(card.planId ?? '');
  const [validUntil, setValid] = useState(card.validUntil ?? '');
  const [holderKind, setHolder] = useState(card.holderKind);
  const [cardNumber, setNumber] = useState('');
  const { pending, run } = useRun();
  const [revealing, startReveal] = useTransition();
  if (card.status === 'replaced') return null;
  const plans = insurer?.plans ?? [];
  return (
    <div className="flex flex-col gap-(--sp-2)">
      <div className="flex flex-wrap gap-(--sp-2)">
        {revealed ? (
          <span
            className="rounded-(--r-sm) bg-surface-2 px-(--sp-2) py-1 font-mono text-(length:--fs-sm)"
            data-testid="card-number-revealed"
          >
            {revealed}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={revealing}
            onClick={() =>
              startReveal(async () => {
                const r = await revealMembershipNumberAction({ membershipId: card.id });
                if (r.ok) setRevealed(r.data);
                else toast.error(r.error);
              })
            }
          >
            Ver número
          </Button>
        )}
        {card.status === 'active' && !card.isPreferred ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(
                () => setPreferredMembershipAction({ membershipId: card.id }),
                'Carteirinha preferencial definida.',
              )
            }
          >
            Tornar preferencial
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')}
        >
          Validade e plano
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPanel(panel === 'replace' ? 'none' : 'replace')}
        >
          Substituir número
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setMembershipActiveAction({
                  membershipId: card.id,
                  active: card.status !== 'active',
                }),
              card.status === 'active'
                ? 'Carteirinha desativada (fica no histórico).'
                : 'Carteirinha reativada.',
            )
          }
        >
          {card.status === 'active' ? 'Desativar' : 'Reativar'}
        </Button>
      </div>
      {panel !== 'none' ? (
        <Box
          onSubmit={() =>
            panel === 'edit'
              ? run(
                  () =>
                    updateMembershipAction({
                      membershipId: card.id,
                      planId: planId || null,
                      holderKind,
                      validUntil: validUntil || null,
                    }),
                  'Carteirinha atualizada.',
                  () => setPanel('none'),
                )
              : run(
                  () =>
                    replaceMembershipAction({
                      membershipId: card.id,
                      cardNumber,
                      planId: planId || null,
                      holderKind,
                      validUntil: validUntil || null,
                    }),
                  'Número substituído; a carteirinha anterior ficou no histórico.',
                  () => setPanel('none'),
                )
          }
        >
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            {panel === 'replace' ? (
              <Field label="Número novo" htmlFor={`${id}-num`} required>
                <Input
                  id={`${id}-num`}
                  value={cardNumber}
                  maxLength={30}
                  autoComplete="off"
                  onChange={(e) => setNumber(e.target.value)}
                />
              </Field>
            ) : null}
            <Field label="Validade" htmlFor={`${id}-valid`}>
              <Input
                id={`${id}-valid`}
                type="date"
                value={validUntil}
                onChange={(e) => setValid(e.target.value)}
              />
            </Field>
            <Field label="Plano" htmlFor={`${id}-plan`}>
              <Select id={`${id}-plan`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Não informado</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Titularidade" htmlFor={`${id}-holder`}>
              <Select
                id={`${id}-holder`}
                value={holderKind}
                onChange={(e) =>
                  setHolder(e.target.value === 'dependente' ? 'dependente' : 'titular')
                }
              >
                <option value="titular">Titular</option>
                <option value="dependente">Dependente</option>
              </Select>
            </Field>
          </div>
          <Actions
            pending={pending}
            onCancel={() => setPanel('none')}
            submit={panel === 'replace' ? 'Substituir' : 'Salvar'}
          />
        </Box>
      ) : null}
    </div>
  );
}

// ── Cobertura de atendimento já agendado ─────────────────────────────────

export function CoverageForm({
  appointmentId,
  patientId,
  insurers,
  label = 'Registrar cobertura',
}: {
  appointmentId: string;
  patientId: string;
  insurers: Array<{ id: string; name: string; plans: Array<{ id: string; name: string }> }>;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<SchedulingCard[]>([]);
  const [insurerId, setInsurerId] = useState('');
  const [planId, setPlanId] = useState('');
  const [membershipId, setMembershipId] = useState('');
  const [guideType, setGuideType] = useState<'consulta' | 'sp_sadt'>('consulta');
  const { pending, run } = useRun();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listSchedulingCardsAction({ patientId }).then((r) => {
      if (alive && r.ok) setCards(r.data);
    });
    return () => {
      alive = false;
    };
  }, [open, patientId]);
  if (insurers.length === 0)
    return <span className="text-(length:--fs-xs) text-fg-muted">Sem operadora ativa</span>;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  const plans = insurers.find((i) => i.id === insurerId)?.plans ?? [];
  const insurerCards = cards.filter((c) => c.insurerId === insurerId);
  return (
    <Box
      onSubmit={() => {
        if (!insurerId) return toast.error('Escolha a operadora.');
        run(
          () =>
            recordAppointmentCoverageAction({
              appointmentId,
              insurerId,
              planId: planId || null,
              membershipId: membershipId || null,
              guideType,
            }),
          'Cobertura registrada.',
          () => setOpen(false),
        );
      }}
    >
      <div className="grid gap-(--sp-3) sm:grid-cols-2">
        <Field label="Operadora" htmlFor={`${id}-ins`} required>
          <Select
            id={`${id}-ins`}
            value={insurerId}
            onChange={(e) => {
              const next = e.target.value;
              setInsurerId(next);
              const pref =
                cards.find((c) => c.insurerId === next && c.preferred) ??
                cards.find((c) => c.insurerId === next);
              setMembershipId(pref?.id ?? '');
              setPlanId(pref?.planId ?? '');
            }}
          >
            <option value="">Selecione…</option>
            {insurers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plano" htmlFor={`${id}-plan`}>
          <Select
            id={`${id}-plan`}
            value={planId}
            disabled={plans.length === 0}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Sem plano específico</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Carteirinha" htmlFor={`${id}-card`}>
          <Select
            id={`${id}-card`}
            value={membershipId}
            disabled={!insurerId}
            onChange={(e) => setMembershipId(e.target.value)}
          >
            <option value="">Informar depois (fica pendente)</option>
            {insurerCards.map((c) => (
              <option key={c.id} value={c.id}>
                {`final ${c.last4}${c.preferred ? ' · preferencial' : ''}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de guia" htmlFor={`${id}-gt`}>
          <Select
            id={`${id}-gt`}
            value={guideType}
            onChange={(e) => setGuideType(e.target.value === 'sp_sadt' ? 'sp_sadt' : 'consulta')}
          >
            <option value="consulta">Consulta</option>
            <option value="sp_sadt">SP/SADT</option>
          </Select>
        </Field>
      </div>
      <Actions pending={pending} onCancel={() => setOpen(false)} submit="Salvar cobertura" />
    </Box>
  );
}

// ── Credenciamento por plano e vigência (P2.2) ───────────────────────────

const ALL_PLANS = '__all__';

/**
 * Registrar o credenciamento da clínica (contratado) ou a habilitação de um profissional
 * numa operadora. O plano é escolhido; "todos os planos" é uma opção EXPLÍCITA (nunca o
 * padrão), porque estar credenciado na operadora não quer dizer estar em todos os planos.
 */
export function NewCredentialForm({
  insurerId,
  plans,
  professionals,
}: {
  insurerId: string;
  plans: Array<{ id: string; name: string; status: string }>;
  professionals: Array<{ id: string; nome: string }>;
}) {
  const id = useId();
  const [target, setTarget] = useState('clinic');
  const [plan, setPlan] = useState('');
  const [providerCode, setCode] = useState('');
  const [validFrom, setFrom] = useState(() => todayYmdIn());
  const [validUntil, setUntil] = useState('');
  const { pending, run } = useRun();
  const activePlans = plans.filter((p) => p.status === 'active');
  return (
    <Toggle label="Registrar credenciamento">
      {(close) => (
        <Box
          onSubmit={() => {
            if (!plan)
              return toast.error(
                'Escolha o plano credenciado (ou, de propósito, todos os planos).',
              );
            run(
              () =>
                createCredentialAction({
                  insurerId,
                  planId: plan === ALL_PLANS ? null : plan,
                  allPlans: plan === ALL_PLANS,
                  professionalId: target === 'clinic' ? null : target,
                  providerCode: providerCode || null,
                  validFrom,
                  validUntil: validUntil || null,
                }),
              'Credenciamento registrado.',
              () => {
                setPlan('');
                setCode('');
                setUntil('');
                close();
              },
            );
          }}
        >
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            <Field label="Quem é credenciado" htmlFor={`${id}-target`} required>
              <Select
                id={`${id}-target`}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="clinic">A clínica (contratado)</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    Profissional: {p.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Plano"
              htmlFor={`${id}-plan`}
              required
              hint="Credenciamento na operadora não vale para todos os planos sem você dizer."
            >
              <Select id={`${id}-plan`} value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="">Escolha…</option>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={ALL_PLANS}>Todos os planos desta operadora</option>
              </Select>
            </Field>
            <Field label="Código na operadora (opcional)" htmlFor={`${id}-code`}>
              <Input
                id={`${id}-code`}
                value={providerCode}
                maxLength={14}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-(--sp-2)">
              <Field label="Vale a partir de" htmlFor={`${id}-from`} required>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={validFrom}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Vale até (opcional)" htmlFor={`${id}-until`}>
                <Input
                  id={`${id}-until`}
                  type="date"
                  value={validUntil}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <Actions pending={pending} onCancel={close} submit="Registrar" />
        </Box>
      )}
    </Toggle>
  );
}

type CredentialMode = 'end' | 'suspend' | 'reactivate' | 'new_period';
const CREDENTIAL_MODE_LABEL: Record<CredentialMode, string> = {
  end: 'Encerrar vigência',
  suspend: 'Suspender',
  reactivate: 'Reativar',
  new_period: 'Nova vigência',
};

/** Encerrar, suspender, reativar ou abrir nova vigência — sempre com motivo; o histórico fica. */
export function CredentialRevisionForm({
  credentialId,
  status,
}: {
  credentialId: string;
  status: 'active' | 'suspended' | 'ended';
}) {
  const id = useId();
  const [mode, setMode] = useState<CredentialMode | null>(null);
  const [date, setDate] = useState(() => todayYmdIn());
  const [until, setUntil] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const { pending, run } = useRun();
  const modes: CredentialMode[] =
    status === 'suspended' ? ['reactivate', 'end'] : ['end', 'suspend', 'new_period'];
  if (!mode) {
    return (
      <div className="flex flex-wrap gap-(--sp-1)">
        {modes.map((m) => (
          <Button key={m} type="button" size="sm" variant="ghost" onClick={() => setMode(m)}>
            {CREDENTIAL_MODE_LABEL[m]}
          </Button>
        ))}
      </div>
    );
  }
  const revision =
    mode === 'end'
      ? { mode, validUntil: date, reason }
      : mode === 'new_period'
        ? {
            mode,
            validFrom: date,
            validUntil: until || null,
            ...(code ? { providerCode: code } : {}),
            reason,
          }
        : { mode, reason };
  return (
    <Box
      onSubmit={() =>
        run(
          () => reviseCredentialAction({ credentialId, revision }),
          'Credenciamento atualizado.',
          () => {
            setMode(null);
            setReason('');
          },
        )
      }
    >
      <p className="text-(length:--fs-sm) font-medium">{CREDENTIAL_MODE_LABEL[mode]}</p>
      <div className="grid gap-(--sp-2) sm:grid-cols-3">
        {mode === 'end' || mode === 'new_period' ? (
          <Field
            label={mode === 'end' ? 'Vale até' : 'Nova vigência a partir de'}
            htmlFor={`${id}-date`}
            required
          >
            <Input
              id={`${id}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        ) : null}
        {mode === 'new_period' ? (
          <>
            <Field label="Até (opcional)" htmlFor={`${id}-until`}>
              <Input
                id={`${id}-until`}
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
            <Field label="Novo código na operadora (opcional)" htmlFor={`${id}-code`}>
              <Input
                id={`${id}-code`}
                value={code}
                maxLength={14}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          </>
        ) : null}
      </div>
      <Field label="Motivo" htmlFor={`${id}-reason`} required>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={300}
          rows={2}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Actions pending={pending} onCancel={() => setMode(null)} submit="Confirmar" />
    </Box>
  );
}

// ── Regras da operadora (P2.5) ───────────────────────────────────────────

/** Regras CONTRATUAIS da operadora. As do padrão TISS não aparecem aqui: não são configuráveis. */
export function InsurerRulesForm({
  insurerId,
  rules,
}: {
  insurerId: string;
  rules: InsurerDetail['insurer']['rules'];
}) {
  const id = useId();
  const [requirePro, setRequirePro] = useState(rules.requireProfessionalCredential);
  const [maxGuides, setMax] = useState(String(rules.maxGuidesPerBatch));
  const [deadline, setDeadline] = useState(
    rules.submissionDeadlineDays === null ? '' : String(rules.submissionDeadlineDays),
  );
  const { pending, run } = useRun();
  return (
    <Toggle label="Alterar regras do contrato">
      {(close) => (
        <Box
          onSubmit={() => {
            const max = Number(maxGuides);
            const days = deadline.trim() === '' ? null : Number(deadline);
            if (!Number.isInteger(max) || max < 1 || max > 100)
              return toast.error('O máximo de guias por lote vai de 1 a 100.');
            if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
              return toast.error('O prazo de envio vai de 1 a 365 dias (ou deixe em branco).');
            }
            run(
              () =>
                saveInsurerRulesAction({
                  insurerId,
                  requireProfessionalCredential: requirePro,
                  maxGuidesPerBatch: max,
                  submissionDeadlineDays: days,
                }),
              'Regras da operadora salvas.',
              close,
            );
          }}
        >
          <label className="flex items-center gap-(--sp-2) text-(length:--fs-sm)">
            <Checkbox
              checked={requirePro}
              onCheckedChange={(v) => setRequirePro(v === true)}
              aria-label="A operadora exige o profissional habilitado"
            />
            A operadora exige o profissional executante habilitado (clínica pessoa jurídica)
          </label>
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            <Field
              label="Máximo de guias por lote"
              htmlFor={`${id}-max`}
              hint="O padrão TISS permite até 100; use menos só se o contrato exigir."
            >
              <Input
                id={`${id}-max`}
                inputMode="numeric"
                value={maxGuides}
                onChange={(e) => setMax(e.target.value)}
              />
            </Field>
            <Field
              label="Prazo de envio (dias depois do atendimento)"
              htmlFor={`${id}-deadline`}
              hint="Opcional; como consta no contrato."
            >
              <Input
                id={`${id}-deadline`}
                inputMode="numeric"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
          </div>
          <Actions pending={pending} onCancel={close} submit="Salvar regras" />
        </Box>
      )}
    </Toggle>
  );
}
