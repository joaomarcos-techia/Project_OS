'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { OptionCardGroup, type OptionCard } from '@/components/ui/option-card-group';
import { isOffer2026PlanCode, PROPOSED_OFFER } from '@/contexts/billing/proposed-offer';
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
    (value.cycle === 'monthly' || value.cycle === 'annual')
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
    (value.selectedBillingCycle === 'monthly' || value.selectedBillingCycle === 'annual') &&
    typeof value.trialDays === 'number' &&
    Number.isInteger(value.trialDays) &&
    value.trialDays > 0 &&
    (value.offerTrialEndsAt === null ||
      (typeof value.offerTrialEndsAt === 'string' &&
        value.offerTrialEndsAt.endsWith('Z') &&
        Number.isFinite(Date.parse(value.offerTrialEndsAt)))) &&
    (value.plans.every((plan) => !isOffer2026PlanCode(plan.code)) ||
      value.offerTrialEndsAt !== null)
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatPrice(priceCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(priceCents / 100);
}

function trialDescription(plan: SignupPlan, state: SignupPlanState): string {
  if (!isOffer2026PlanCode(plan.code)) {
    return `${state.trialDays} dias grátis após a ativação`;
  }
  const deadline = state.offerTrialEndsAt;
  if (!deadline) return 'Prazo de avaliação indisponível';
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(deadline));
  return `${PROPOSED_OFFER.proposedTrialDays} dias desde a criação da conta; termina em ${formatted} (Brasília). Após esse horário, acesso só com pagamento confirmado.`;
}

function selectedTrialDescription(
  state: SignupPlanState,
  selectedPlanId: string | undefined,
  cycle: 'monthly' | 'annual',
): string {
  const plan = state.plans.find((item) => item.id === selectedPlanId && item.cycle === cycle);
  return plan ? trialDescription(plan, state) : 'Plano selecionado';
}

function trustedCheckoutUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const trustedHost = url.hostname === 'asaas.com' || url.hostname === 'sandbox.asaas.com';
    return url.protocol === 'https:' && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

export function PlanSelectionForm() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<SignupPlanState | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [selectedCycle, setSelectedCycle] = useState<'monthly' | 'annual'>('monthly');
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
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
        setSelectedCycle(body.selectedBillingCycle);
        setSelectedPlanId(
          body.selectedPlanId &&
            body.plans.some(
              (plan) => plan.id === body.selectedPlanId && plan.cycle === body.selectedBillingCycle,
            )
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
      (state?.plans ?? [])
        .filter((plan) => plan.cycle === selectedCycle)
        .map((plan) => ({
          value: plan.id,
          label: (
            <span className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-fg">{plan.name}</span>
              <span className="flex items-baseline gap-1 text-primary">
                <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">
                  {formatPrice(plan.priceCents)}
                </span>
                <span className="text-xs font-medium text-fg-muted">
                  /{selectedCycle === 'annual' ? 'ano' : 'mês'}
                </span>
              </span>
            </span>
          ),
          description: state ? trialDescription(plan, state) : '',
        })),
    [state, selectedCycle],
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
        body: JSON.stringify({
          rowVersion: state.rowVersion,
          planId: selectedPlanId,
          cycle: selectedCycle,
        }),
      });
      const body = await responseJson(response);
      if (
        response.ok &&
        isRecord(body) &&
        typeof body.rowVersion === 'number' &&
        Number.isInteger(body.rowVersion) &&
        body.selectedPlanId === selectedPlanId &&
        body.selectedBillingCycle === selectedCycle
      ) {
        setState({
          ...state,
          rowVersion: body.rowVersion,
          selectedPlanId,
          selectedBillingCycle: selectedCycle,
        });
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

  /** Inicia a página hospedada. O Asaas coleta identificação, endereço e cartão. */
  async function finish() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(null);
    try {
      const response = await fetch('/api/signup/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await responseJson(response);
      if (response.ok && isRecord(body)) {
        if (body.state === 'provisioned') {
          window.location.assign('/auth/session-refresh?next=/dashboard');
          return;
        }
        if (body.state === 'pending') {
          window.location.assign('/cadastro/pagamento?resultado=pending');
          return;
        }
        const checkoutUrl = trustedCheckoutUrl(body.checkoutUrl);
        if (body.state === 'checkout_pending' && checkoutUrl) {
          window.location.assign(checkoutUrl);
          return;
        }
      }
      if (response.status === 410) {
        setPhase('expired');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setPhase('signed_out');
        return;
      }
      if (response.status === 402) {
        setFinishError(
          'O provedor de pagamento recusou a assinatura. Nenhuma cobrança foi feita — revise os dados e tente novamente.',
        );
        return;
      }
      if (response.status === 409) {
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
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-(--r-md) bg-surface-inset px-4 py-2.5">
        <p className="text-xs font-medium text-fg-subtle">Clínica</p>
        <p className="truncate text-sm font-semibold text-fg">{state.clinicName}</p>
      </div>
      {state.plans.some((plan) => plan.cycle === 'annual') ? (
        <div className="flex gap-2" role="group" aria-label="Ciclo de cobrança">
          {(['monthly', 'annual'] as const).map((cycle) => (
            <Button
              key={cycle}
              type="button"
              variant={selectedCycle === cycle ? 'primary' : 'secondary'}
              aria-pressed={selectedCycle === cycle}
              disabled={saving || finishing}
              onClick={() => {
                setSelectedCycle(cycle);
                if (
                  !state.plans.some((plan) => plan.id === selectedPlanId && plan.cycle === cycle)
                ) {
                  setSelectedPlanId(undefined);
                }
                setSaved(false);
                setMessage(null);
              }}
            >
              {cycle === 'monthly' ? 'Mensal' : 'Anual · preço de 10 meses'}
            </Button>
          ))}
        </div>
      ) : null}
      {selectedCycle === 'annual' ? (
        <p className="text-sm text-fg-muted">
          Cobrança integral no cartão após o prazo de avaliação, com renovação automática a cada
          ano. Pix anual estará disponível posteriormente.
        </p>
      ) : null}
      <fieldset disabled={saving} className="space-y-2.5">
        <legend className="mb-2.5 text-sm font-semibold text-fg">
          Plano {selectedCycle === 'annual' ? 'anual' : 'mensal'}
        </legend>
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
          className="grid gap-3 md:grid-cols-3"
        />
      </fieldset>
      <div aria-live="polite" className="space-y-2">
        {saved ? (
          <Alert variant="success" title="Plano salvo">
            {selectedTrialDescription(state, selectedPlanId, selectedCycle)}. O pagamento acontece
            com segurança na página do Asaas.
          </Alert>
        ) : null}
        {message ? <Alert variant="warning">{message}</Alert> : null}
        {finishError ? <Alert variant="warning">{finishError}</Alert> : null}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <a href="/cadastro/continuar" className={buttonVariants({ variant: 'secondary' })}>
          Voltar aos dados
        </a>
        {saved ? (
          <Button
            type="button"
            onClick={() => void finish()}
            loading={finishing}
            className="sm:min-w-64"
          >
            Continuar no Checkout Asaas
          </Button>
        ) : (
          <Button type="submit" loading={saving} className="sm:min-w-40">
            Salvar plano
          </Button>
        )}
      </div>
    </form>
  );
}
