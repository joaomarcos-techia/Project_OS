'use client';

/**
 * Wizard de ativação (F1) — UI portada do Claude Design (ClinicaOS - Ativação).
 * Cenas: welcome → clinic → owner(acesso) → plan → checkout → processing → done.
 *
 * Os passos clinic/owner/plan POSTam em saveStepAction (persistência retomável por
 * `version`). A senha do gestor fica SÓ no cliente (nunca no step_state). O checkout
 * coleta o cartão apenas em memória para o checkout transparente do Asaas e dispara a animação de
 * provisionamento → done. Cada step é remontado por `key` p/ o useActionState zerar.
 */
import { useActionState, useEffect, useRef, useState } from 'react';

import { formatTrialDays } from '@/contexts/onboarding/trial';
import type { OnboardingPlan } from '@/contexts/onboarding/internal/invites';
import type { OnboardingStep, StepState } from '@/contexts/onboarding/internal/step-state';
import { maskCep, maskCnpj, maskCpfCnpj, maskPhoneBR } from '@/lib/masks';

import {
  saveStepAction,
  submitCheckoutAction,
  type CheckoutState,
  type JoinStepState,
} from './actions';

import { TurnstileWidget } from '@/components/shared/turnstile-widget';

type View = 'welcome' | OnboardingStep | 'processing' | 'done';
const INITIAL: JoinStepState = { error: null };
const STEPS: OnboardingStep[] = ['clinic', 'owner', 'plan', 'checkout'];
const STEP_LABEL: Record<OnboardingStep, string> = {
  clinic: 'Clínica',
  owner: 'Acesso',
  plan: 'Plano',
  checkout: 'Pagamento',
};

/* ---------- ícones (inline, do design) ---------- */
const s = (d: string, w = '2') => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={w}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d.split('|').map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);
const I = {
  check: s('M5 12l5 5L20 6', '2.4'),
  arrowR: s('M9 6l6 6-6 6'),
  arrowL: s('M15 18l-6-6 6-6'),
  lock: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  shield: s('M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z|M9.5 12l1.8 1.8L15 10'),
  mail: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  ),
  phone: s(
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  ),
  pin: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  alert: s(
    'M12 9v4M12 17h.01|M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ),
  clock: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z" />
    </svg>
  ),
  card: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
    </svg>
  ),
  layers: s('M12 3 3 8l9 5 9-5-9-5z|M3 13l9 5 9-5'),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary-600)" />
      <path
        d="M9 16.5l4.5 4.5L23 11"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const fmtBRL = (cents: number | null) =>
  cents == null
    ? 'Sob consulta'
    : `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

/* ---------- máscaras do cartão (as de doc/cep/telefone vêm de @/lib/masks) ---------- */
const onlyD = (v: string) => v.replace(/\D/g, '');
const maskCard = (v: string) =>
  onlyD(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
const maskExpiry = (v: string) => {
  const d = onlyD(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const maskCvv = (v: string) => onlyD(v).slice(0, 4);
const maskNum = (v: string) => onlyD(v).slice(0, 10);

/** Senha forte sugerida (cliente). Alfabeto sem caracteres ambíguos. */
function genPassword(len = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => alphabet[n % alphabet.length]).join('');
}

/* ===================================================================== */

export function JoinWizard({
  token,
  initialState,
  suggestedEmail,
  suggestedPlanId,
  plans,
}: {
  token: string;
  initialState: StepState;
  suggestedEmail: string | null;
  suggestedPlanId: string | null;
  plans: OnboardingPlan[];
}) {
  const fresh = initialState.currentStep === 'clinic' && initialState.completed.length === 0;
  const [view, setView] = useState<View>(fresh ? 'welcome' : initialState.currentStep);
  const [clinicName, setClinicName] = useState(initialState.clinic?.nome ?? '');
  const [planId, setPlanId] = useState(
    initialState.planId ?? suggestedPlanId ?? plans[0]?.id ?? '',
  );
  const [ownerPassword, setOwnerPassword] = useState('');

  const selectedPlan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;

  return (
    <div className="wiz scene-anim">
      <header className="wiz-top">
        {/* Marca removida do fluxo de convite (decisão do founder). */}
        <div className="right">
          <span className="wiz-secure">{I.lock} Ambiente seguro</span>
        </div>
      </header>

      <div className="wiz-main">
        {(['clinic', 'owner', 'plan', 'checkout'] as const).includes(view as OnboardingStep) ? (
          <Stepper current={view as OnboardingStep} />
        ) : null}

        {view === 'welcome' ? (
          <Welcome
            email={suggestedEmail}
            planName={plans.find((p) => p.id === suggestedPlanId)?.name ?? null}
            onStart={() => setView('clinic')}
          />
        ) : null}

        {view === 'clinic' ? (
          <StepClinic
            key="clinic"
            token={token}
            defaults={initialState.clinic}
            clinicName={clinicName}
            onName={setClinicName}
            onDone={() => setView('owner')}
          />
        ) : null}

        {view === 'owner' ? (
          <StepOwner
            key="owner"
            token={token}
            defaults={initialState.owner}
            suggestedEmail={suggestedEmail}
            onPassword={setOwnerPassword}
            onBack={() => setView('clinic')}
            onDone={() => setView('plan')}
          />
        ) : null}

        {view === 'plan' ? (
          <StepPlan
            key="plan"
            token={token}
            plans={plans}
            planId={planId}
            suggestedPlanId={suggestedPlanId}
            onPick={setPlanId}
            onBack={() => setView('owner')}
            onDone={() => setView('checkout')}
          />
        ) : null}

        {view === 'checkout' ? (
          <StepCheckout
            token={token}
            clinicName={clinicName}
            plan={selectedPlan}
            ownerPassword={ownerPassword}
            onChangePlan={() => setView('plan')}
            onActivated={() => setView('processing')}
          />
        ) : null}

        {view === 'processing' ? <Processing onDone={() => setView('done')} /> : null}

        {view === 'done' ? <OnboardingComplete /> : null}
      </div>
    </div>
  );
}

/* ---------- chrome ---------- */
function Stepper({ current }: { current: OnboardingStep }) {
  const cur = STEPS.indexOf(current);
  return (
    <div className="wiz-steps">
      {STEPS.map((st, i) => {
        const cls = i < cur ? 'done' : i === cur ? 'active' : '';
        return (
          <span key={st} style={{ display: 'contents' }}>
            <span className={`ws ${cls}`}>
              <span className="num">{i < cur ? I.check : i + 1}</span>
              <span className="lbl">{STEP_LABEL[st]}</span>
            </span>
            {i < STEPS.length - 1 ? <span className={`bar ${i < cur ? 'fill' : ''}`} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function useStepAction(onDone: () => void) {
  const [state, action, pending] = useActionState(saveStepAction, INITIAL);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return { state, action, pending };
}

/* ---------- welcome ---------- */
function Welcome({
  email,
  planName,
  onStart,
}: {
  email: string | null;
  planName: string | null;
  onStart: () => void;
}) {
  return (
    <div className="wiz-card welcome">
      <div className="mark">
        <Logo size={60} />
      </div>
      <h1>Vamos configurar sua clínica</h1>
      <p>São só 2 minutos para deixar tudo pronto.</p>
      {email ? (
        <div className="invite-card">
          <span className="ic-ico">{I.mail}</span>
          <span className="ic-txt">
            <span className="ic-l">Convite enviado para</span>
            <b>{email}</b>
          </span>
          <span className="ic-chk" title="Convite válido">
            {I.check}
          </span>
        </div>
      ) : null}
      <div className="reassure">
        <div className="r">{I.check} Configure os dados da sua clínica</div>
        <div className="r">{I.check} Crie seu acesso de gestor</div>
        <div className="r">
          {I.check} Ative
          {planName ? (
            <>
              {' '}
              no plano <b style={{ color: 'var(--text)', fontWeight: 600 }}>
                &nbsp;{planName}
              </b>{' '}
              combinado
            </>
          ) : (
            ' sua clínica'
          )}
        </div>
      </div>
      <button type="button" className="btn block" onClick={onStart}>
        Começar {I.arrowR}
      </button>
      <div className="foot-secure">{I.shield} Ambiente isolado e auditado · LGPD</div>
    </div>
  );
}

/* ---------- clinic ---------- */
function StepClinic({
  token,
  defaults,
  clinicName,
  onName,
  onDone,
}: {
  token: string;
  defaults?: StepState['clinic'];
  clinicName: string;
  onName: (v: string) => void;
  onDone: () => void;
}) {
  const { state, action, pending } = useStepAction(onDone);
  const [cnpj, setCnpj] = useState(maskCnpj(defaults?.cnpj ?? ''));
  const [telefone, setTelefone] = useState(maskPhoneBR(defaults?.telefone ?? ''));
  return (
    <form action={action} className="wiz-card">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="step" value="clinic" />
      <div className="wiz-h">
        <span className="eyebrow">
          <span className="dot" /> Sua clínica
        </span>
        <h1>Conte sobre sua clínica</h1>
        <p>Essas informações serão usadas para configurar seu ambiente.</p>
      </div>
      <div className="flow-panel form-col">
        <div className="field">
          <label>Nome da clínica *</label>
          <input
            name="nome"
            className="input"
            required
            maxLength={120}
            value={clinicName}
            onChange={(e) => onName(e.target.value)}
            placeholder="Clínica São Lucas"
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label>CNPJ</label>
            <input
              name="cnpj"
              className="input"
              maxLength={18}
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              placeholder="00.000.000/0001-00"
              autoCapitalize="characters"
            />
          </div>
          <div className="field">
            <label>Telefone</label>
            <div className="input-wrap">
              {I.phone}
              <input
                name="telefone"
                className="input"
                maxLength={16}
                value={telefone}
                onChange={(e) => setTelefone(maskPhoneBR(e.target.value))}
                placeholder="(11) 90000-0000"
                inputMode="tel"
              />
            </div>
          </div>
        </div>
        <div className="field">
          <label>Endereço</label>
          <div className="input-wrap">
            {I.pin}
            <input
              name="endereco"
              className="input"
              maxLength={240}
              defaultValue={defaults?.endereco ?? ''}
              placeholder="Rua, número, cidade"
            />
          </div>
        </div>
      </div>
      {state.error ? (
        <p style={{ color: 'var(--danger-600)', fontSize: 13, marginTop: 8 }}>{state.error}</p>
      ) : null}
      <div className="wiz-foot end">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Salvando…' : 'Continuar'} {I.arrowR}
        </button>
      </div>
    </form>
  );
}

/* ---------- owner / acesso ---------- */
function StepOwner({
  token,
  defaults,
  suggestedEmail,
  onPassword,
  onBack,
  onDone,
}: {
  token: string;
  defaults?: StepState['owner'];
  suggestedEmail: string | null;
  onPassword: (v: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const { state, action, pending } = useStepAction(onDone);
  const [pw, setPw] = useState('');
  const [reveal, setReveal] = useState(false);
  const setPassword = (v: string) => {
    setPw(v);
    onPassword(v);
  };
  const rules = {
    len: pw.length >= 8,
    mix: /[a-zA-Z]/.test(pw) && /\d/.test(pw),
    sym: /[^a-zA-Z0-9]/.test(pw),
  };
  return (
    <form action={action} className="wiz-card">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="step" value="owner" />
      <div className="wiz-h">
        <span className="eyebrow">
          <span className="dot" /> Seu acesso
        </span>
        <h1>Crie seu acesso administrativo</h1>
        <p>Você será o gestor responsável por esta clínica.</p>
      </div>
      <div className="flow-panel form-col">
        <div className="field">
          <label>Nome completo *</label>
          <input
            name="nome"
            className="input"
            required
            maxLength={120}
            defaultValue={defaults?.nome ?? ''}
            placeholder="João Silva"
          />
        </div>
        <div className="field">
          <label>E-mail *</label>
          <div className="input-wrap">
            {I.mail}
            <input
              name="email"
              className="input"
              type="email"
              required
              maxLength={160}
              defaultValue={defaults?.email ?? suggestedEmail ?? ''}
            />
          </div>
        </div>
        <div className="field">
          <label>Senha *</label>
          <div className="pw-row">
            <input
              className="input"
              type={reveal ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Crie uma senha forte"
            />
            <button type="button" className="btn secondary sm" onClick={() => setReveal((r) => !r)}>
              {reveal ? 'ocultar' : 'mostrar'}
            </button>
          </div>
          <div className="pw-check">
            <div className={`pc ${rules.len ? 'ok' : ''}`}>{I.check} Mínimo de 8 caracteres</div>
            <div className={`pc ${rules.mix ? 'ok' : ''}`}>{I.check} Letras e números</div>
            <div className={`pc ${rules.sym ? 'ok' : ''}`}>{I.check} Um símbolo (recomendado)</div>
          </div>
          <button
            type="button"
            className="pw-suggest"
            onClick={() => {
              setPassword(genPassword(12));
              setReveal(true);
            }}
          >
            Sugerir senha forte (12 caracteres)
          </button>
        </div>
        <div className="note">
          {I.shield}
          <p>
            <b>Não guardamos sua senha durante o cadastro.</b> Ela é usada apenas para criar seu
            acesso seguro ao final do processo.
          </p>
        </div>
      </div>
      {state.error ? (
        <p style={{ color: 'var(--danger-600)', fontSize: 13, marginTop: 8 }}>{state.error}</p>
      ) : null}
      <div className="wiz-foot">
        <button type="button" className="wiz-back" onClick={onBack}>
          {I.arrowL} Voltar
        </button>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Salvando…' : 'Continuar para o plano'} {I.arrowR}
        </button>
      </div>
    </form>
  );
}

/* ---------- plan ---------- */
function StepPlan({
  token,
  plans,
  planId,
  suggestedPlanId,
  onPick,
  onBack,
  onDone,
}: {
  token: string;
  plans: OnboardingPlan[];
  planId: string;
  suggestedPlanId: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const { state, action, pending } = useStepAction(onDone);
  return (
    <form action={action} className="wiz-card wide">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="step" value="plan" />
      <input type="hidden" name="planId" value={planId} />
      <div className="wiz-h" style={{ textAlign: 'center' }}>
        <h1>Escolha seu plano</h1>
        <p>Você pode trocar de plano a qualquer momento, direto no painel.</p>
      </div>
      <div className="wiz-plans">
        {plans.map((p) => {
          const rec = p.id === suggestedPlanId;
          const sel = p.id === planId;
          return (
            <div key={p.id} className={`wcard ${rec ? 'rec' : ''} ${sel ? 'sel' : ''}`}>
              {rec ? <span className="rec-tag">{I.star} Recomendado</span> : null}
              <span className="nm">{p.name}</span>
              <span className="pr">
                {/* O riscado só aparece quando existe preço de tabela DIFERENTE
                    do cobrado. Sem isso o wizard exibiria um "de" que nunca foi
                    praticado — o desconto perde o sentido e vira propaganda
                    enganosa. */}
                {p.listPriceCents != null ? (
                  <s className="was" aria-label={`Preço de tabela ${fmtBRL(p.listPriceCents)}`}>
                    {fmtBRL(p.listPriceCents)}
                  </s>
                ) : null}
                <span className="amt">{fmtBRL(p.priceCents)}</span>
                <span className="per">/{p.cycle === 'annual' ? 'ano' : 'mês'}</span>
              </span>
              {p.listPriceCents != null ? (
                <span className="founder">Preço de fundador — vale para sempre</span>
              ) : null}
              <ul>
                <li>
                  {I.check} Cobrança {p.cycle === 'annual' ? 'anual' : 'mensal'}
                </li>
                <li>{I.check} Suporte incluído</li>
                <li>{I.check} Cancele quando quiser</li>
              </ul>
              <button
                type={sel ? 'submit' : 'button'}
                className={`btn ${sel ? '' : 'secondary'}`}
                disabled={sel && pending}
                onClick={sel ? undefined : () => onPick(p.id)}
              >
                {sel ? (pending ? 'Salvando…' : 'Continuar') : 'Escolher'}
              </button>
            </div>
          );
        })}
        {plans.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>Nenhum plano disponível.</p>
        ) : null}
      </div>
      {state.error ? (
        <p style={{ color: 'var(--danger-600)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
          {state.error}
        </p>
      ) : null}
      <div className="wiz-foot end" style={{ justifyContent: 'center', marginTop: 'var(--sp-6)' }}>
        <button type="button" className="wiz-back" onClick={onBack}>
          {I.arrowL} Voltar
        </button>
      </div>
      <div className="foot-secure">{I.lock} Pagamento seguro · processado por Asaas</div>
    </form>
  );
}

/* ---------- checkout ---------- */
function StepCheckout({
  token,
  clinicName,
  plan,
  ownerPassword,
  onChangePlan,
  onActivated,
}: {
  token: string;
  clinicName: string;
  plan: OnboardingPlan | null;
  ownerPassword: string;
  onChangePlan: () => void;
  onActivated: () => void;
}) {
  const [state, action, pending] = useActionState(submitCheckoutAction, {
    error: null,
  } as CheckoutState);
  // Token de uso único: cada tentativa de ativação precisa de um novo. Cartão
  // recusado é o caso comum de reenvio, e sem o reset a segunda tentativa
  // falharia por captcha em vez de dizer o que houve com o cartão.
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  useEffect(() => {
    if (state.ok) onActivated();
  }, [state.ok, onActivated]);
  useEffect(() => {
    if (state.error) setCaptchaAttempt((n) => n + 1);
  }, [state.error]);
  // Senha vive só no cliente; em retomada (outra aba/sessão) o estado some → pede de novo.
  const needsPassword = !ownerPassword;
  const mt = { marginTop: 'var(--sp-5)' };
  const [billingHolderName, setBillingHolderName] = useState('');
  const [billingHolderEmail, setBillingHolderEmail] = useState('');
  const [billingHolderPhone, setBillingHolderPhone] = useState('');
  const [doc, setDoc] = useState('');
  const [cep, setCep] = useState('');
  const [num, setNum] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');

  return (
    <form action={action} className="wiz-card wide">
      <input type="hidden" name="token" value={token} />
      {needsPassword ? null : <input type="hidden" name="password" value={ownerPassword} />}
      <div className="wiz-h">
        <span className="eyebrow">
          <span className="dot" /> Última etapa
        </span>
        <h1>Finalizar ativação</h1>
        <p>Revise os dados e confirme para liberar seu ambiente.</p>
      </div>
      <div className="pay2">
        <div>
          {state.cardError ? (
            <div className="card-err">
              {I.alert}
              <div>
                <b>Não conseguimos validar esse cartão.</b>
                <p>{state.error}</p>
              </div>
            </div>
          ) : null}

          <div className="pay-section-label">Titular da cobrança</div>
          <div className="fgroup">
            <div className="frow">
              <div className="fcell">
                <label>Nome completo do titular</label>
                <input
                  name="billingHolderName"
                  value={billingHolderName}
                  onChange={(e) => setBillingHolderName(e.target.value.slice(0, 120))}
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Nome da pessoa ou empresa responsável"
                />
              </div>
            </div>
            <div className="frow two">
              <div className="fcell mono">
                <label>CPF ou CNPJ do titular</label>
                <input
                  name="billingHolderCpfCnpj"
                  value={doc}
                  onChange={(e) => setDoc(maskCpfCnpj(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={18}
                  placeholder="000.000.000-00"
                />
              </div>
              <div className="fcell">
                <label>E-mail do titular</label>
                <input
                  name="billingHolderEmail"
                  type="email"
                  value={billingHolderEmail}
                  onChange={(e) => setBillingHolderEmail(e.target.value.slice(0, 160))}
                  required
                  maxLength={160}
                  autoComplete="email"
                  placeholder="titular@exemplo.com"
                />
              </div>
            </div>
            <div className="frow two">
              <div className="fcell mono">
                <label>Telefone do titular</label>
                <input
                  name="billingHolderPhone"
                  value={billingHolderPhone}
                  onChange={(e) => setBillingHolderPhone(maskPhoneBR(e.target.value))}
                  required
                  inputMode="tel"
                  maxLength={16}
                  autoComplete="tel"
                  placeholder="(11) 90000-0000"
                />
              </div>
              <div className="fcell mono">
                <label>CEP do titular</label>
                <input
                  name="cep"
                  value={cep}
                  onChange={(e) => setCep(maskCep(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={9}
                  autoComplete="postal-code"
                  placeholder="00000-000"
                />
              </div>
            </div>
            <div className="frow">
              <div className="fcell mono">
                <label>Número do endereço do titular</label>
                <input
                  name="addressNumber"
                  value={num}
                  onChange={(e) => setNum(maskNum(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="address-line2"
                  placeholder="nº"
                />
              </div>
            </div>
            <div className="note">
              {I.info}
              <p>
                Use os dados da pessoa ou empresa que responde pelo cartão. Eles podem ser
                diferentes da clínica e do responsável pelo acesso.
              </p>
            </div>
          </div>

          {needsPassword ? (
            <>
              <div className="pay-section-label" style={mt}>
                Confirme sua senha de acesso
              </div>
              <div className="fgroup">
                <div className="frow">
                  <div className="fcell">
                    <label>Senha</label>
                    <input
                      name="password"
                      type="password"
                      minLength={8}
                      required
                      autoComplete="new-password"
                      placeholder="mínimo 8 caracteres"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <div className="pay-section-label" style={mt}>
            Dados do cartão
          </div>
          <div className="fgroup">
            <div className="frow">
              <div className="fcell mono">
                <label>Número do cartão</label>
                <input
                  name="cardNumber"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(maskCard(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={23}
                  placeholder="0000 0000 0000 0000"
                  autoComplete="cc-number"
                />
              </div>
            </div>
            <div className="frow">
              <div className="fcell">
                <label>Nome impresso no cartão</label>
                <input
                  name="cardName"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value.slice(0, 60))}
                  required
                  maxLength={60}
                  placeholder="Como está no cartão"
                  style={{ textTransform: 'uppercase' }}
                  autoComplete="cc-name"
                />
                <small>Copie exatamente como aparece no cartão.</small>
              </div>
            </div>
            <div className="frow two">
              <div className="fcell mono">
                <label>Validade</label>
                <input
                  name="cardExpiry"
                  value={expiry}
                  onChange={(e) => setExpiry(maskExpiry(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="MM/AA"
                  autoComplete="cc-exp"
                />
              </div>
              <div className="fcell mono">
                <label>CVV</label>
                <input
                  name="cardCvv"
                  value={cvv}
                  onChange={(e) => setCvv(maskCvv(e.target.value))}
                  required
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="000"
                  autoComplete="cc-csc"
                />
              </div>
            </div>
          </div>

          {/* O token gasto aqui é o do auto-login pós-checkout: o
              provisionamento usa a service role e não passa por captcha. */}
          <TurnstileWidget action="checkout" resetSignal={captchaAttempt} />

          {state.error && !state.cardError ? (
            <p style={{ color: 'var(--danger-600)', fontSize: 13, marginTop: 10 }}>{state.error}</p>
          ) : null}

          <button type="submit" className="btn block" disabled={pending} style={mt}>
            {pending ? 'Ativando…' : <>{I.lock} Ativar minha clínica</>}
          </button>
          <div className="trust-mini">
            <span className="tm">{I.shield} Pagamento integrado ao Asaas</span>
            <span className="tm">
              {I.check} {formatTrialDays()} · cancele quando quiser
            </span>
          </div>
        </div>

        <aside className="recap2">
          <div className="ra-hero">
            <div className="ra-label">Cobrança após o teste</div>
            <div className="ra-amount">
              {fmtBRL(plan?.priceCents ?? null)}
              <span className="per">/{plan?.cycle === 'annual' ? 'ano' : 'mês'}</span>
            </div>
            <div className="ra-secure">{I.lock} Pagamento seguro · Asaas</div>
          </div>
          <div className="ra-rule" />
          <div className="os-title">Resumo do pedido</div>
          <div className="os-line">
            <span className="l">
              Plano {plan?.name ?? '—'}
              <small>{clinicName || 'sua clínica'}</small>
            </span>
            <span className="v">{fmtBRL(plan?.priceCents ?? null)}</span>
          </div>
          <div className="os-line">
            <span className="l">Teste grátis ({formatTrialDays()})</span>
            <span className="v">incluído</span>
          </div>
          <div className="os-rule" />
          <div className="os-total">
            <span className="l">Hoje</span>
            <span className="v">{fmtBRL(0)}</span>
          </div>
          <button type="button" className="change-plan" onClick={onChangePlan}>
            Trocar de plano
          </button>
        </aside>
      </div>
    </form>
  );
}

/* ---------- processing ---------- */
function Processing({ onDone }: { onDone: () => void }) {
  const PROC = [
    { label: 'Validando pagamento', ico: I.card },
    { label: 'Criando ambiente', ico: I.layers },
    { label: 'Configurando acesso', ico: I.lock },
    { label: 'Preparando painel', ico: I.grid },
  ];
  const [active, setActive] = useState(-1);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let i = 0;
    const tick = () => {
      setActive(i);
      i++;
      if (i <= PROC.length) {
        timer = setTimeout(tick, 850);
      } else {
        timer = setTimeout(() => doneRef.current(), 500);
      }
    };
    let timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="wiz-card proc">
      <div className="spinner" />
      <h1>Configurando sua clínica…</h1>
      <p>Isso leva só alguns segundos. Não feche esta página.</p>
      <div className="proc-steps">
        {PROC.map((st, i) => {
          const cls = i < active ? 'ok' : i === active ? 'run' : '';
          return (
            <div key={st.label} className={`proc-step ${cls}`}>
              <span className="ico">
                {i < active ? I.check : i === active ? st.ico : <span className="dot3" />}
              </span>
              {st.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- done ---------- */
export function OnboardingComplete() {
  return (
    <div className="wiz-card done">
      <div className="mark">{I.check}</div>
      <h1>Sua clínica está pronta 🎉</h1>
      <p>Bem-vindo ao Qoro. Seu ambiente foi criado com sucesso.</p>
      <a className="btn block" href="/dashboard" style={{ marginTop: 'var(--sp-6)' }}>
        Entrar no painel {I.arrowR}
      </a>
      <div className="foot-secure">{I.check} Sua clínica está pronta para acesso.</div>
    </div>
  );
}
