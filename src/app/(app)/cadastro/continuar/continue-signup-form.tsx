'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fieldControlClassName, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SignupAnswerValues, SignupDraftState } from '@/contexts/onboarding';
import { SIGNUP_INPUT_LIMITS } from '@/contexts/onboarding/signup-input-limits';

type Phase = 'loading' | 'form' | 'owned' | 'unavailable' | 'signed_out';

const LABELS = {
  professionalsBand: {
    '1': '1 profissional',
    '2_5': '2 a 5 profissionais',
    '6_15': '6 a 15 profissionais',
    '16_plus': '16 ou mais profissionais',
  },
  weeklyAppointmentsBand: {
    ate_20: 'Até 20 por semana',
    '21_50': '21 a 50 por semana',
    '51_100': '51 a 100 por semana',
    '100_plus': 'Mais de 100 por semana',
  },
  currentTooling: {
    nada_papel: 'Nada ou papel',
    agenda_generica: 'Agenda genérica',
    outro_sistema: 'Outro sistema',
  },
  discoverySource: {
    busca_google: 'Busca no Google',
    indicacao_colega: 'Indicação de um colega',
    redes_sociais: 'Redes sociais',
    grupo_comunidade: 'Grupo ou comunidade',
    evento: 'Evento ou congresso',
    outro: 'Outro',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnswers(value: unknown): value is SignupAnswerValues {
  if (!isRecord(value)) return false;
  return (
    typeof value.professionalsBand === 'string' &&
    value.professionalsBand in LABELS.professionalsBand &&
    typeof value.weeklyAppointmentsBand === 'string' &&
    value.weeklyAppointmentsBand in LABELS.weeklyAppointmentsBand &&
    typeof value.currentTooling === 'string' &&
    value.currentTooling in LABELS.currentTooling &&
    typeof value.discoverySource === 'string' &&
    value.discoverySource in LABELS.discoverySource
  );
}

function isOwnedDraft(value: unknown): value is SignupDraftState {
  if (!isRecord(value) || !isAnswers(value.answers)) return false;
  return (
    value.status === 'email_verified' &&
    typeof value.rowVersion === 'number' &&
    Number.isInteger(value.rowVersion) &&
    typeof value.ownerName === 'string' &&
    typeof value.clinicName === 'string' &&
    typeof value.idleExpiresAt === 'string' &&
    typeof value.absoluteExpiresAt === 'string'
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function ContinueSignupForm() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [answers, setAnswers] = useState<Partial<SignupAnswerValues>>({});
  const [owned, setOwned] = useState<SignupDraftState | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    setPhase('loading');
    setMessage(null);
    try {
      const draftResponse = await fetch('/api/signup/draft', { cache: 'no-store' });
      const draftBody = await responseJson(draftResponse);
      if (draftResponse.ok && isOwnedDraft(draftBody)) {
        setOwned(draftBody);
        setPhase('owned');
        return;
      }
      if (draftResponse.status === 401 || draftResponse.status === 403) {
        setPhase('signed_out');
        return;
      }
      if (draftResponse.status !== 410) {
        setMessage('Não foi possível consultar seu cadastro agora. Tente novamente.');
        setPhase('unavailable');
        return;
      }

      // 410 aqui significa que o servidor procurou pelo e-mail já verificado e
      // não achou cadastro vivo nenhum — o prazo absoluto venceu, ou nunca
      // houve. Só neste caso pedimos os dados de novo.
      setAnswers({});
      setPhase('form');
    } catch {
      setMessage('A conexão falhou durante a consulta. Tente novamente.');
      setPhase('unavailable');
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  async function loadOwnedAfterWrite(): Promise<boolean> {
    const response = await fetch('/api/signup/draft', { cache: 'no-store' });
    const body = await responseJson(response);
    if (response.ok && isOwnedDraft(body)) {
      setOwned(body);
      setPhase('owned');
      return true;
    }
    if (response.status === 401 || response.status === 403) setPhase('signed_out');
    return false;
  }

  function changeAnswer<K extends keyof SignupAnswerValues>(
    field: K,
    value: SignupAnswerValues[K],
  ) {
    setAnswers((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const owner = form.elements.namedItem('ownerName');
    const clinic = form.elements.namedItem('clinicName');
    const invalid = [owner, clinic].find(
      (field) =>
        field instanceof HTMLInputElement && (!field.validity.valid || !field.value.trim()),
    );
    if (invalid instanceof HTMLInputElement) {
      invalid.focus();
      setMessage('Preencha seu nome e o nome da clínica.');
      return;
    }
    if (!isAnswers(answers)) {
      form.querySelector<HTMLSelectElement>('select:invalid')?.focus();
      setMessage('Revise as quatro respostas antes de continuar.');
      return;
    }
    if (!accepted) {
      form.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus();
      setMessage('Confirme o aceite para concluir o cadastro verificado.');
      return;
    }
    if (!(owner instanceof HTMLInputElement) || !(clinic instanceof HTMLInputElement)) return;

    const body = {
      ownerName: owner.value.trim(),
      clinicName: clinic.value.trim(),
      answers,
      accepted: true,
    };
    submitting.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        if (!(await loadOwnedAfterWrite())) {
          setMessage('Os dados foram aceitos, mas a revisão não pôde ser carregada agora.');
          setPhase('unavailable');
        }
      } else if (response.status === 409) {
        if (!(await loadOwnedAfterWrite())) {
          setMessage('Outra aba concluiu o cadastro primeiro. Recarregue para ver o resultado.');
        }
      } else if (response.status === 401 || response.status === 403) {
        setPhase('signed_out');
      } else if (response.status === 429) {
        setMessage('Muitas tentativas em pouco tempo. Aguarde antes de confirmar novamente.');
      } else {
        setMessage('Não foi possível confirmar os dados. Tente novamente.');
      }
    } catch {
      setMessage('A conexão falhou antes da confirmação. Os dados continuam somente nesta tela.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="py-8 text-center" aria-live="polite">
        <div
          aria-label="Carregando"
          className="mx-auto size-6 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <p className="mt-3 text-sm text-fg-muted">Consultando seu cadastro verificado…</p>
      </div>
    );
  }

  if (phase === 'signed_out') {
    return (
      <Alert variant="warning" title="Sessão encerrada">
        <p>Entre novamente para continuar com a conta verificada.</p>
        <a href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Ir para o login
        </a>
      </Alert>
    );
  }

  if (phase === 'unavailable') {
    return (
      <div className="space-y-4">
        <Alert variant="warning">{message}</Alert>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (phase === 'owned' && owned) {
    return (
      <div className="space-y-5">
        <Alert variant="success" title="Cadastro recuperado na conta verificada">
          Estes são os dados do seu cadastro, mesmo que você tenha começado em outro aparelho. A
          criação da clínica ainda não foi iniciada.
        </Alert>
        <ReviewList draft={owned} />
        <a href="/cadastro/plano" className={buttonVariants({ variant: 'primary' })}>
          Escolher plano
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Alert variant="info" title="E-mail confirmado">
        Não encontramos um cadastro em andamento para este endereço — ele pode ter expirado.
        Preencha os dados novamente para continuar.
      </Alert>
      <fieldset disabled={saving} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="continue-owner">Seu nome</Label>
          <Input
            id="continue-owner"
            name="ownerName"
            autoComplete="name"
            maxLength={SIGNUP_INPUT_LIMITS.personName}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="continue-clinic">Nome da clínica</Label>
          <Input
            id="continue-clinic"
            name="clinicName"
            autoComplete="organization"
            maxLength={SIGNUP_INPUT_LIMITS.clinicName}
            required
          />
        </div>
        <AnswerFields answers={answers} onChange={changeAnswer} />
        <div className="flex min-h-10 items-start gap-3 pt-1">
          <Checkbox
            id="continue-accepted"
            checked={accepted}
            onCheckedChange={(value) => setAccepted(value === true)}
            disabled={saving}
            className="mt-0.5"
          />
          <Label htmlFor="continue-accepted" className="text-pretty text-sm leading-relaxed">
            Confirmo os dados acima e aceito os Termos de Uso e a Política de Privacidade.
          </Label>
        </div>
      </fieldset>
      <div aria-live="polite">{message ? <Alert variant="warning">{message}</Alert> : null}</div>
      <Button type="submit" loading={saving} className="w-full">
        Confirmar e continuar
      </Button>
    </form>
  );
}

function AnswerFields({
  answers,
  onChange,
}: {
  answers: Partial<SignupAnswerValues>;
  onChange: <K extends keyof SignupAnswerValues>(field: K, value: SignupAnswerValues[K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id="continue-professionals"
        label="Profissionais"
        value={answers.professionalsBand}
        options={LABELS.professionalsBand}
        onChange={(value) => onChange('professionalsBand', value)}
      />
      <SelectField
        id="continue-appointments"
        label="Atendimentos por semana"
        value={answers.weeklyAppointmentsBand}
        options={LABELS.weeklyAppointmentsBand}
        onChange={(value) => onChange('weeklyAppointmentsBand', value)}
      />
      <SelectField
        id="continue-tooling"
        label="Organização atual"
        value={answers.currentTooling}
        options={LABELS.currentTooling}
        onChange={(value) => onChange('currentTooling', value)}
      />
      <SelectField
        id="continue-discovery"
        label="Como conheceu a Qoro"
        value={answers.discoverySource}
        options={LABELS.discoverySource}
        onChange={(value) => onChange('discoverySource', value)}
      />
    </div>
  );
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        required
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value as T)}
        className={fieldControlClassName}
      >
        <option value="">Selecione</option>
        {(Object.entries(options) as [T, string][]).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReviewList({ draft }: { draft: SignupDraftState }) {
  return (
    <dl className="grid gap-3 rounded-(--r-md) bg-surface-inset p-4 text-sm">
      <ReviewItem label="Responsável" value={draft.ownerName} />
      <ReviewItem label="Clínica" value={draft.clinicName} />
      <ReviewItem
        label="Profissionais"
        value={LABELS.professionalsBand[draft.answers.professionalsBand]}
      />
      <ReviewItem
        label="Atendimentos"
        value={LABELS.weeklyAppointmentsBand[draft.answers.weeklyAppointmentsBand]}
      />
      <ReviewItem label="Organização" value={LABELS.currentTooling[draft.answers.currentTooling]} />
      <ReviewItem label="Origem" value={LABELS.discoverySource[draft.answers.discoverySource]} />
    </dl>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 font-medium text-fg">{value}</dd>
    </div>
  );
}
