'use client';

import { ArrowLeft, LockKeyhole, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { OptionCardGroup, type OptionCard } from '@/components/ui/option-card-group';
import { PublicBlock, signupFrame } from '@/components/shared/signup-frame';
import {
  isOffer2026PlanCode,
  OFFER_2026_PLAN_CODES,
  PROPOSED_OFFER,
} from '@/contexts/billing/proposed-offer';
import type { SignupPlan, SignupPlanState } from '@/contexts/onboarding';
import { TRIAL_RESOURCE_LIMITS } from '@/lib/trial-access/policy';
import { cn } from '@/lib/ui/cn';

import {
  clinicaPlanFor,
  doctorsOf,
  familyDescription,
  familyName,
  familyOf,
  formatPrice,
  offerCatalog,
  summaryLines,
  firstChargeFor,
  formatIsoDate,
  type PlanFamily,
} from './checkout-summary';
import styles from './plano.module.css';

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
    (value.signupFlow === undefined || value.signupFlow === 'trial_first') &&
    (value.pilot === undefined || typeof value.pilot === 'boolean') &&
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
  // No desenho da oferta, o aviso "Plano salvo" só aparece depois de salvar nesta visita: no
  // carregamento, o plano já está no resumo.
  const [savedNow, setSavedNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Estado "cartão recusado" da prancha: o provedor recusou (402) e nada foi cobrado.
  const [declined, setDeclined] = useState(false);
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
        setSaved(
          Boolean(
            body.selectedPlanId &&
            body.plans.some(
              (plan) => plan.id === body.selectedPlanId && plan.cycle === body.selectedBillingCycle,
            ),
          ),
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
              {isOffer2026PlanCode(plan.code) ? (
                <span className="text-xs text-fg-muted">
                  {OFFER_2026_PLAN_CODES.indexOf(plan.code) + 1}{' '}
                  {plan.code === 'consultorio_2026' ? 'médico' : 'médicos'} + até{' '}
                  {plan.code === 'consultorio_2026'
                    ? PROPOSED_OFFER.consultorioIncludedStaffLogins
                    : PROPOSED_OFFER.clinicaIncludedStaffLogins}{' '}
                  acessos administrativos
                </span>
              ) : null}
              {isOffer2026PlanCode(plan.code) ? (
                <span className="text-xs font-medium text-fg">
                  Até{' '}
                  {OFFER_2026_PLAN_CODES.indexOf(plan.code) +
                    1 +
                    (plan.code === 'consultorio_2026'
                      ? PROPOSED_OFFER.consultorioIncludedStaffLogins
                      : PROPOSED_OFFER.clinicaIncludedStaffLogins)}{' '}
                  pessoas incluídas no total
                </span>
              ) : null}
              <span className="flex items-baseline gap-1 text-primary">
                <span className={styles.planPrice}>{formatPrice(plan.priceCents)}</span>
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
    setMessage(null);
    setFinishError(null);
    try {
      if (saved) {
        await finish();
        return;
      }
      setSaving(true);
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
        setSavedNow(true);
        setSaving(false);
        await finish();
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
   * Conclui a etapa. Com cartão, inicia a página hospedada (o Asaas coleta identificação, endereço e
   * cartão). No `trial_first` do #53, inicia a avaliação; o piloto C3 provisiona pela rota própria.
   */
  async function finish() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(null);
    setDeclined(false);
    try {
      const response = await fetch(
        state?.pilot ? '/api/signup/pilot/provision' : '/api/signup/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
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
        setDeclined(true);
        return;
      }
      if (response.status === 409) {
        const reason = isRecord(body) ? body.error : null;
        setFinishError(
          reason === 'trial_used'
            ? 'Esta conta já utilizou a avaliação gratuita. Entre na conta original para continuar; um novo cadastro não reinicia o prazo.'
            : reason === 'reconcile_required'
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
      <PublicBlock narrow>
        <div className={signupFrame.center} aria-live="polite">
          <div
            aria-label="Carregando"
            className="size-6 animate-spin rounded-full border-2 border-border border-t-primary"
          />
          <p className={signupFrame.note}>Consultando planos disponíveis…</p>
        </div>
      </PublicBlock>
    );
  }

  if (phase === 'signed_out') {
    return (
      <PublicBlock narrow>
        <Alert variant="warning" title="Sessão encerrada">
          <p>Entre novamente para continuar com a conta verificada.</p>
          <a href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Ir para o login
          </a>
        </Alert>
      </PublicBlock>
    );
  }

  if (phase === 'expired') {
    return (
      <PublicBlock narrow>
        <Alert variant="warning" title="Cadastro temporário expirado">
          <p>Inicie um novo cadastro para escolher o plano.</p>
          <a href="/cadastro" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Recomeçar cadastro
          </a>
        </Alert>
      </PublicBlock>
    );
  }

  if (phase === 'unavailable') {
    return (
      <PublicBlock narrow>
        <Alert variant="warning">{message}</Alert>
        <div className={signupFrame.actions}>
          <Button
            type="button"
            variant="secondary"
            className={signupFrame.buttonFull}
            onClick={() => void load()}
          >
            Tentar novamente
          </Button>
        </div>
      </PublicBlock>
    );
  }

  if (!state || state.plans.length === 0) {
    return (
      <PublicBlock narrow>
        <Alert variant="warning" title="Planos indisponíveis">
          Nenhum plano pode ser contratado neste momento.
        </Alert>
        <div className={signupFrame.actions}>
          <Button
            type="button"
            variant="secondary"
            className={signupFrame.buttonFull}
            onClick={() => void load()}
          >
            Atualizar planos
          </Button>
        </div>
      </PublicBlock>
    );
  }

  const selectedPlan = state.plans.find(
    (plan) => plan.id === selectedPlanId && plan.cycle === selectedCycle,
  );
  // Desenho aprovado (Claude Design, "Cadastro · 3. Checkout"): à esquerda o pagamento, à direita o
  // resumo com a família do plano e os médicos. O cartão é informado na página hospedada do
  // provedor, nunca aqui. Planos fora da oferta 2026 (legado) seguem na lista de opções.
  const trialFirst = state.signupFlow === 'trial_first';
  // Integração #53 -> #56: o desenho aprovado cobre a etapa com cartão. No `trial_first` do #53 não
  // há cartão nesta etapa; a tela usa o ramo de lista de planos da mesma moldura, com o texto da
  // avaliação, como os specs do #53 homologaram.
  const catalog = trialFirst ? null : offerCatalog(state.plans, selectedCycle);
  const busy = saving || finishing;
  const family: PlanFamily | null = selectedPlan ? familyOf(selectedPlan) : null;
  const doctors = selectedPlan ? doctorsOf(selectedPlan) : null;
  const otherFamilyPlan =
    catalog && family === 'clinica'
      ? catalog.consultorio
      : catalog && family === 'consultorio'
        ? clinicaPlanFor(catalog, 2)
        : null;
  const minDoctors = catalog?.clinica[0]?.doctors ?? 2;
  const maxDoctors = catalog?.clinica.at(-1)?.doctors ?? 2;
  const perCycle = selectedCycle === 'annual' ? 'ano' : 'mês';

  function choose(planId: string | undefined) {
    setSelectedPlanId(planId);
    setSaved(false);
    setSavedNow(false);
    setMessage(null);
    setFinishError(null);
    setDeclined(false);
  }

  const cycleToggle = state.plans.some((plan) => plan.cycle === 'annual') ? (
    <div className={signupFrame.segmented} role="group" aria-label="Ciclo de cobrança">
      {(['monthly', 'annual'] as const).map((cycle) => (
        <Button
          key={cycle}
          type="button"
          variant={selectedCycle === cycle ? 'primary' : 'secondary'}
          aria-pressed={selectedCycle === cycle}
          disabled={busy}
          onClick={() => {
            setSelectedCycle(cycle);
            const current = state.plans.find((plan) => plan.id === selectedPlanId);
            // Na oferta, a troca de ciclo mantém a mesma quantidade de médicos.
            const same = current
              ? state.plans.find((plan) => plan.cycle === cycle && plan.code === current.code)
              : undefined;
            if (same) setSelectedPlanId(same.id);
            else if (
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
  ) : null;

  const trialQuotas = state.plans.every((plan) => isOffer2026PlanCode(plan.code)) ? (
    <>
      Durante a avaliação: até {TRIAL_RESOURCE_LIMITS.patients.limit} pacientes,{' '}
      {TRIAL_RESOURCE_LIMITS.appointments.limit} agendamentos e{' '}
      {TRIAL_RESOURCE_LIMITS.documents.limit} documentos e receitas no total. Os demais cadastros
      limitados têm cota de {TRIAL_RESOURCE_LIMITS.procedures.limit} por categoria. WhatsApp,
      conexão com Asaas e convites de equipe ficam disponíveis após a confirmação do pagamento da
      assinatura. As vagas de médicos e equipe seguem o plano contratado.
    </>
  ) : null;

  const seatRules = state.plans.some((plan) => isOffer2026PlanCode(plan.code)) ? (
    <>
      <p className={signupFrame.fine}>
        Atendente: já está incluído nos {PROPOSED_OFFER.clinicaIncludedStaffLogins} acessos
        administrativos, assim como gestão e financeiro. Hoje não há compra online de um quarto
        acesso administrativo.
      </p>
      <p className={signupFrame.fine}>
        Médicos extras na Clínica: R$ {PROPOSED_OFFER.additionalProfessionalMonthly}/mês por médico,
        até chegar a {PROPOSED_OFFER.maxSelfServiceProfessionals} médicos +{' '}
        {PROPOSED_OFFER.clinicaIncludedStaffLogins} administrativos = até{' '}
        {PROPOSED_OFFER.maxSelfServiceProfessionals + PROPOSED_OFFER.clinicaIncludedStaffLogins}{' '}
        logins.
      </p>
      <p className={signupFrame.fine}>
        O papel Médico ocupa uma vaga médica, mesmo antes de preencher o CRM. Dono ou gestor com CRM
        cadastrado também conta como médico, sem ocupar outro acesso administrativo; sem CRM, conta
        na equipe administrativa.
      </p>
    </>
  ) : null;

  const live = (
    <div aria-live="polite" className={cn('space-y-2', styles.live)}>
      {saved && (savedNow || !catalog) ? (
        <Alert variant="success" title="Plano salvo">
          {selectedTrialDescription(state, selectedPlanId, selectedCycle).replace(/\.$/u, '')}.{' '}
          {trialFirst
            ? 'Nenhum cartão ou pagamento é necessário para iniciar a avaliação.'
            : 'O pagamento acontece com segurança na página do Asaas.'}
        </Alert>
      ) : null}
      {message ? <Alert variant="warning">{message}</Alert> : null}
      {finishError ? <Alert variant="warning">{finishError}</Alert> : null}
    </div>
  );

  const declinedAlert = declined ? (
    <Alert variant="danger" title="O provedor recusou o pagamento. Nada foi cobrado.">
      Confira os dados do cartão na página segura ou use outro cartão, e tente de novo.
    </Alert>
  ) : null;

  const actionsWith = (nota: string | null) => (
    <>
      <div className={cn(signupFrame.actions, styles.actionsBottom)}>
        <a
          href="/cadastro/continuar"
          aria-label="Voltar aos dados da clínica"
          className={cn(buttonVariants({ variant: 'ghost' }), styles.back)}
        >
          <ArrowLeft aria-hidden="true" className="size-[18px]" />
          Voltar
        </a>
        {/* Estado "processando" da prancha: aqui é a abertura do pagamento seguro. */}
        <Button type="submit" loading={busy} className={styles.grow}>
          {trialFirst
            ? 'Começar avaliação gratuita'
            : finishing
              ? 'Abrindo o pagamento seguro…'
              : 'Continuar para o checkout'}
        </Button>
      </div>
      {nota ? <p className={signupFrame.fine}>{nota}</p> : null}
    </>
  );
  const actions = actionsWith(
    trialFirst
      ? null
      : 'Ao continuar, a página segura do Asaas abre para você informar o cartão. Nada é cobrado hoje; a mensalidade segue o resumo do plano.',
  );

  if (!catalog) {
    return (
      <form onSubmit={submit} className={signupFrame.checkout}>
        <section className={signupFrame.pay}>
          <h2 className={signupFrame.subtitle}>Planos disponíveis</h2>
          {declinedAlert}
          {trialQuotas ? (
            <Alert variant="info" title="O que você pode testar">
              {trialQuotas}
            </Alert>
          ) : null}
          {cycleToggle}
          {selectedCycle === 'annual' ? (
            <p className={signupFrame.note}>
              Cobrança integral no cartão após o prazo de avaliação, com renovação automática a cada
              ano. Pix anual estará disponível posteriormente.
            </p>
          ) : null}
          <fieldset disabled={busy} className={signupFrame.fields}>
            <legend className="mb-2.5 text-sm font-semibold text-fg">
              Plano {selectedCycle === 'annual' ? 'anual' : 'mensal'}
            </legend>
            <OptionCardGroup
              name="signupPlan"
              value={selectedPlanId}
              onValueChange={choose}
              options={options}
              disabled={busy}
              aria-label="Planos disponíveis"
              className={cn(signupFrame.optionsSingle)}
            />
          </fieldset>
          {live}
          {actions}
        </section>

        <aside className={signupFrame.summary} aria-labelledby="signup-plan-summary">
          <div>
            <span className={signupFrame.eyebrow}>Plano escolhido</span>
            <h2 id="signup-plan-summary" className={signupFrame.planName}>
              {selectedPlan ? selectedPlan.name : 'Selecione um plano'}
            </h2>
          </div>
          <div className={signupFrame.lines}>
            <p className={signupFrame.row}>
              <span>Clínica</span>
              <b className="min-w-0 break-words">{state.clinicName}</b>
            </p>
          </div>
          {selectedPlan ? (
            <>
              <div className={signupFrame.separator} />
              <div className={signupFrame.total}>
                <span className={signupFrame.totalLabel}>
                  {trialFirst
                    ? 'Mensalidade do plano'
                    : selectedCycle === 'annual'
                      ? 'Total anual'
                      : 'Total mensal'}
                </span>
                <b>
                  {formatPrice(selectedPlan.priceCents)}
                  <small>/{perCycle}</small>
                </b>
              </div>
              <div className={signupFrame.panel}>
                <p className={signupFrame.row}>
                  <span>Avaliação</span>
                  <b>{trialDescription(selectedPlan, state)}</b>
                </p>
              </div>
            </>
          ) : null}
          {seatRules ? <div className={signupFrame.lines}>{seatRules}</div> : null}
        </aside>
      </form>
    );
  }

  const deadline =
    selectedPlan && isOffer2026PlanCode(selectedPlan.code) && state.offerTrialEndsAt
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Sao_Paulo',
        }).format(new Date(state.offerTrialEndsAt))
      : null;
  // A tela diz o que vai acontecer pela mesma regra do servidor (ver `firstChargeFor`).
  const charge =
    selectedPlan && isOffer2026PlanCode(selectedPlan.code) && state.offerTrialEndsAt
      ? firstChargeFor(state.offerTrialEndsAt, new Date())
      : null;
  const footer = !charge
    ? 'Ao continuar, a página segura do Asaas abre para você informar o cartão.'
    : charge.expired
      ? 'Ao continuar, a página segura do Asaas abre para você informar o cartão. A avaliação terminou: a primeira mensalidade é cobrada hoje.'
      : `Ao continuar, a página segura do Asaas abre para você informar o cartão. Nada é cobrado hoje; a primeira mensalidade vence em ${formatIsoDate(charge.dueDate)}.`;

  return (
    <form onSubmit={submit} className={signupFrame.checkout}>
      <section className={signupFrame.pay} aria-labelledby="signup-payment-title">
        <h2 id="signup-payment-title" className={signupFrame.subtitle}>
          Cartão de crédito
        </h2>
        {declinedAlert}
        {cycleToggle}
        {selectedCycle === 'annual' ? (
          <p className={signupFrame.note}>
            Cobrança integral no cartão após o prazo de avaliação, com renovação automática a cada
            ano. Pix anual estará disponível posteriormente.
          </p>
        ) : null}
        <div className={styles.secure}>
          <LockKeyhole aria-hidden="true" className={styles.secureIcon} />
          <p>
            <b>O cartão é informado na página segura do Asaas.</b> Ela abre no próximo passo; a Qoro
            não recebe nem guarda os dados do cartão.
          </p>
        </div>
        {trialQuotas ? (
          <div className={styles.quotas}>
            <p className={styles.quotasTitle}>O que você pode testar</p>
            <p className={signupFrame.fine}>{trialQuotas}</p>
          </div>
        ) : null}
        {live}
        {actionsWith(footer)}
      </section>

      <aside className={signupFrame.summary} aria-labelledby="signup-plan-summary">
        <div className={signupFrame.plan}>
          <div>
            <span className={signupFrame.eyebrow}>Plano escolhido</span>
            <h2 id="signup-plan-summary" className={signupFrame.planName}>
              {family ? familyName(family) : 'Escolha o plano'}
            </h2>
          </div>
          {family && otherFamilyPlan ? (
            <button
              type="button"
              className={styles.swap}
              disabled={busy}
              aria-label={`Trocar plano: mudar para ${familyName(family === 'clinica' ? 'consultorio' : 'clinica')}`}
              onClick={() => choose(otherFamilyPlan.id)}
            >
              Trocar plano
            </button>
          ) : null}
        </div>

        {family ? (
          <p className={styles.description}>{familyDescription(family)}</p>
        ) : (
          <div className={styles.families} role="group" aria-label="Escolha o plano">
            {catalog.consultorio ? (
              <button
                type="button"
                className={styles.familyOption}
                disabled={busy}
                onClick={() => choose(catalog.consultorio?.id)}
              >
                <b>Consultório</b>
                <span>
                  1 médico · {formatPrice(catalog.consultorio.priceCents)}/{perCycle}
                </span>
              </button>
            ) : null}
            {catalog.clinica[0] ? (
              <button
                type="button"
                className={styles.familyOption}
                disabled={busy}
                onClick={() => choose(catalog.clinica[0]?.plan.id)}
              >
                <b>Clínica</b>
                <span>
                  {minDoctors === maxDoctors
                    ? `${minDoctors} médicos`
                    : `De ${minDoctors} a ${maxDoctors} médicos`}{' '}
                  · a partir de {formatPrice(catalog.clinica[0].plan.priceCents)}/{perCycle}
                </span>
              </button>
            ) : null}
          </div>
        )}

        {family === 'clinica' && doctors ? (
          <div className={styles.quantity}>
            <div>
              <p id="signup-doctors-label" className={styles.quantityTitle}>
                Médicos na clínica
              </p>
              <p className={styles.quantityHint}>
                {minDoctors === maxDoctors
                  ? 'Amplie depois, na assinatura.'
                  : `De ${minDoctors} a ${maxDoctors} médicos.`}
              </p>
            </div>
            <div className={styles.stepper} role="group" aria-labelledby="signup-doctors-label">
              <button
                type="button"
                aria-label="Menos um médico"
                disabled={busy || doctors <= minDoctors}
                onClick={() => choose(clinicaPlanFor(catalog, doctors - 1)?.id)}
              >
                <Minus aria-hidden="true" />
              </button>
              <output aria-live="polite">{doctors}</output>
              <button
                type="button"
                aria-label="Mais um médico"
                disabled={busy || doctors >= maxDoctors}
                onClick={() => choose(clinicaPlanFor(catalog, doctors + 1)?.id)}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {selectedPlan && family ? (
          <>
            <div className={signupFrame.lines}>
              {summaryLines(selectedPlan, catalog).map((line) => (
                <p key={line.label} className={signupFrame.row}>
                  <span>{line.label}</span>
                  <b>{line.value}</b>
                </p>
              ))}
            </div>
            <div className={signupFrame.separator} />
            <div className={signupFrame.total}>
              <span className={signupFrame.totalLabel}>
                {selectedCycle === 'annual' ? 'Total anual' : 'Total mensal'}
              </span>
              <b>
                {formatPrice(selectedPlan.priceCents)}
                <small>/{perCycle}</small>
              </b>
            </div>
            <div className={signupFrame.panel}>
              {charge ? (
                <>
                  <p className={signupFrame.row}>
                    <span>Hoje</span>
                    {charge.expired ? (
                      <b>{formatPrice(selectedPlan.priceCents)} · primeira mensalidade</b>
                    ) : (
                      <b className={styles.okValue}>
                        R$ 0,00 · {charge.remainingDays}{' '}
                        {charge.remainingDays === 1 ? 'dia grátis' : 'dias grátis'}
                      </b>
                    )}
                  </p>
                  <p className={signupFrame.row}>
                    <span>Primeira mensalidade</span>
                    <b>{charge.expired ? 'hoje' : formatIsoDate(charge.dueDate)}</b>
                  </p>
                  <p className={styles.panelNote}>
                    {charge.expired
                      ? `A avaliação terminou em ${deadline} (Brasília). O acesso continua só com o pagamento confirmado.`
                      : `Grátis até ${deadline} (Brasília); a avaliação conta desde a criação da conta. Depois desse horário, o acesso continua só com o pagamento confirmado.`}
                  </p>
                </>
              ) : (
                <p className={signupFrame.row}>
                  <span>Avaliação</span>
                  <b>Prazo indisponível</b>
                </p>
              )}
            </div>
          </>
        ) : null}

        <p className={signupFrame.fine}>
          Sem fidelidade: cancele a renovação quando quiser e o acesso segue até o fim do período
          pago. Taxas da Meta e do Asaas não estão incluídas na assinatura.
        </p>
        {seatRules ? (
          <details className={styles.rules}>
            <summary>Como contamos médicos e acessos</summary>
            <div className={signupFrame.lines}>{seatRules}</div>
          </details>
        ) : null}
      </aside>
    </form>
  );
}
