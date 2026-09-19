'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionCardGroup, type OptionCard } from '@/components/ui/option-card-group';
import type { SignupPlan, SignupPlanState } from '@/contexts/onboarding';

type Phase = 'loading' | 'ready' | 'unavailable' | 'signed_out' | 'expired';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlan(value: unknown): value is SignupPlan {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.priceCents === 'number' &&
    Number.isSafeInteger(value.priceCents) &&
    value.priceCents >= 0 &&
    value.cycle === 'monthly'
  );
}

function isPlanState(value: unknown): value is SignupPlanState {
  if (!isRecord(value) || !Array.isArray(value.plans) || !value.plans.every(isPlan)) return false;
  return (
    value.status === 'email_verified' &&
    typeof value.rowVersion === 'number' &&
    Number.isInteger(value.rowVersion) &&
    typeof value.clinicName === 'string' &&
    (value.selectedPlanId === null || typeof value.selectedPlanId === 'string') &&
    typeof value.trialDays === 'number' &&
    Number.isInteger(value.trialDays) &&
    value.trialDays > 0
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatMonthlyPrice(priceCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(priceCents / 100);
}

export function PlanSelectionForm() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<SignupPlanState | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [document, setDocument] = useState('');
  const started = useRef(false);
  const submitting = useRef(false);
  const finishingRef = useRef(false);

  const load = useCallback(async () => {
    setPhase('loading');
    setMessage(null);
    setSaved(false);
    try {
      const response = await fetch('/api/signup/plan', { cache: 'no-store' });
      const body = await responseJson(response);
      if (response.ok && isPlanState(body)) {
        setState(body);
        setSelectedPlanId(
          body.selectedPlanId && body.plans.some((plan) => plan.id === body.selectedPlanId)
            ? body.selectedPlanId
            : undefined,
        );
        setPhase('ready');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setPhase('signed_out');
        return;
      }
      if (response.status === 410) {
        setPhase('expired');
        return;
      }
      setMessage('Não foi possível consultar os planos agora. Tente novamente.');
      setPhase('unavailable');
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

  const options = useMemo<OptionCard<string>[]>(
    () =>
      (state?.plans ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
        description: `${formatMonthlyPrice(plan.priceCents)} por mês · ${state?.trialDays ?? 0} dias grátis após a ativação`,
      })),
    [state],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !state) return;
    if (!selectedPlanId) {
      setMessage('Selecione um plano para continuar.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setSaved(false);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/plan', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowVersion: state.rowVersion, planId: selectedPlanId }),
      });
      const body = await responseJson(response);
      if (
        response.ok &&
        isRecord(body) &&
        typeof body.rowVersion === 'number' &&
        Number.isInteger(body.rowVersion) &&
        body.selectedPlanId === selectedPlanId
      ) {
        setState({ ...state, rowVersion: body.rowVersion, selectedPlanId });
        setSaved(true);
      } else if (response.status === 409 || response.status === 422) {
        await load();
        setMessage(
          response.status === 409
            ? 'O cadastro foi atualizado em outra aba. Revise a escolha carregada.'
            : 'Esse plano não está mais disponível. Escolha uma opção atualizada.',
        );
      } else if (response.status === 410) {
        setPhase('expired');
      } else if (response.status === 401 || response.status === 403) {
        setPhase('signed_out');
      } else if (response.status === 429) {
        setMessage('Muitas tentativas em pouco tempo. Aguarde antes de salvar novamente.');
      } else {
        setMessage('Não foi possível salvar o plano. Tente novamente.');
      }
    } catch {
      setMessage('A conexão falhou antes de salvar. Sua escolha continua somente nesta tela.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  /**
   * Fecha o cadastro: assina e provisiona. O corpo leva SÓ o documento — o
   * servidor já sabe o plano, e o preço nunca sai daqui. O documento está aqui
   * porque o Asaas recusa assinar sem ele (medido no sandbox, ADR-053).
   *
   * Sucesso não navega direto para `/dashboard`: passa por `session-refresh`,
   * porque o JWT desta aba ainda é o de antes da clínica existir e não carrega
   * as claims de tenant/papel. Sem a rotação, o dashboard receberia uma sessão
   * que ainda não sabe quem a pessoa virou.
   */
  async function finish() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(null);
    try {
      const response = await fetch('/api/signup/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cpfCnpj: document }),
      });
      if (response.ok) {
        window.location.assign('/auth/session-refresh?next=/dashboard');
        return;
      }
      if (response.status === 410) {
        setPhase('expired');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setPhase('signed_out');
        return;
      }
      if (response.status === 422) {
        setFinishError(
          'Confira o CPF ou CNPJ: os dígitos não conferem. Nada foi enviado ao provedor de pagamento.',
        );
        return;
      }
      if (response.status === 402) {
        setFinishError(
          'O provedor de pagamento recusou a assinatura. Nenhuma cobrança foi feita — revise os dados e tente novamente.',
        );
        return;
      }
      if (response.status === 409) {
        const body = await responseJson(response);
        const reason = isRecord(body) ? body.error : null;
        setFinishError(
          reason === 'reconcile_required'
            ? 'Estamos confirmando sua assinatura com o provedor. Recarregue esta página em alguns minutos; não tente de novo agora para não duplicar a cobrança.'
            : 'O cadastro mudou em outra aba. Recarregue a página e confira a escolha antes de continuar.',
        );
        return;
      }
      if (response.status === 429) {
        setFinishError('Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.');
        return;
      }
      setFinishError('Não foi possível concluir agora. Tente novamente em instantes.');
    } catch {
      setFinishError(
        'A conexão falhou durante a ativação. Recarregue a página antes de tentar de novo — a assinatura pode ter sido criada.',
      );
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="py-8 text-center" aria-live="polite">
        <div
          aria-label="Carregando"
          className="mx-auto size-6 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <p className="mt-3 text-sm text-fg-muted">Consultando planos disponíveis…</p>
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

  if (phase === 'expired') {
    return (
      <Alert variant="warning" title="Cadastro temporário expirado">
        <p>Inicie um novo cadastro para escolher o plano.</p>
        <a href="/cadastro" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Recomeçar cadastro
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

  if (!state || state.plans.length === 0) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" title="Planos indisponíveis">
          Nenhum plano pode ser contratado neste momento.
        </Alert>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          Atualizar planos
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-(--r-md) bg-surface-inset px-4 py-3">
        <p className="text-xs font-medium text-fg-subtle">Clínica</p>
        <p className="mt-0.5 text-sm font-semibold text-fg">{state.clinicName}</p>
      </div>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="mb-3 text-sm font-semibold text-fg">Plano mensal</legend>
        <OptionCardGroup
          name="signupPlan"
          value={selectedPlanId}
          onValueChange={(value) => {
            setSelectedPlanId(value);
            setSaved(false);
            setMessage(null);
          }}
          options={options}
          disabled={saving}
          aria-label="Planos disponíveis"
        />
      </fieldset>
      <div aria-live="polite" className="space-y-3">
        {saved ? (
          <Alert variant="success" title="Plano salvo">
            Seus {state.trialDays} dias grátis começam quando a clínica for ativada. A primeira
            cobrança vence só no fim desse período, e o pagamento acontece na página do provedor —
            nós não pedimos cartão aqui.
          </Alert>
        ) : null}
        {message ? <Alert variant="warning">{message}</Alert> : null}
        {finishError ? <Alert variant="warning">{finishError}</Alert> : null}
      </div>
      {saved ? (
        <div className="space-y-3 rounded-(--r-md) border border-border bg-surface-muted p-4">
          <Field
            label="CPF ou CNPJ do responsável pela cobrança"
            htmlFor="signup-billing-document"
            hint="O provedor de pagamento exige o documento para emitir a assinatura. Ele não aparece na sua clínica nem em relatórios."
          >
            <Input
              id="signup-billing-document"
              name="cpfCnpj"
              inputMode="numeric"
              autoComplete="off"
              maxLength={18}
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              placeholder="000.000.000-00"
            />
          </Field>
          <Button
            type="button"
            onClick={() => void finish()}
            loading={finishing}
            disabled={document.trim().length === 0}
            className="w-full"
          >
            Ativar clínica e entrar
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <a href="/cadastro/continuar" className={buttonVariants({ variant: 'secondary' })}>
          Voltar aos dados
        </a>
        <Button type="submit" loading={saving} className="sm:min-w-40">
          Salvar plano
        </Button>
      </div>
    </form>
  );
}
