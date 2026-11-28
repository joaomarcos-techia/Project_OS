'use client';

import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  PublicBlock,
  PublicHeading,
  SignupStage,
  signupFrame,
} from '@/components/shared/signup-frame';
import { TurnstileWidget } from '@/components/shared/turnstile-widget';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OptionCardGroup, type OptionCard } from '@/components/ui/option-card-group';
import type {
  SignupAnswerValues,
  SignupSessionState,
  SignupSessionStatus,
} from '@/contexts/onboarding';
import { cn } from '@/lib/ui/cn';

import styles from './cadastro.module.css';
import { SignupEmailPending } from './signup-email-pending';
import { SignupCodeConfirmation } from './signup-code-confirmation';
import { SignupEmailVerified } from './signup-email-verified';
import { SignupIdentity } from './signup-identity';
import { readOnboardingInviteToken } from '@/lib/auth/onboarding-invite-fragment';

type ProfessionalsBand = SignupAnswerValues['professionalsBand'];
type WeeklyAppointmentsBand = SignupAnswerValues['weeklyAppointmentsBand'];
type CurrentTooling = SignupAnswerValues['currentTooling'];
type DiscoverySource = SignupAnswerValues['discoverySource'];
type Draft = Partial<SignupAnswerValues>;
type LocalDraft = { answers: Draft; expiresAt: number };
type Phase = 'loading' | 'challenge' | 'ready' | 'expired' | 'unavailable';
type QuestionIndex = 0 | 1 | 2 | 3;
type ContinuationCredentials = { email: string };

const EMPTY_DRAFT: Draft = {};
const QUESTION_COUNT = 4;
const CONFIRMATION_POLL_INTERVAL_MS = 20_000;
const PILOT_SIGNUP_PATH = '/cadastro/piloto';
const LOCAL_DRAFT_KEY = 'qoro-signup-answers-v1';
const LOCAL_DRAFT_TTL_MS = 60 * 60 * 1_000;

const PROFESSIONAL_OPTIONS: OptionCard<ProfessionalsBand>[] = [
  { value: '1', label: '1 médico' },
  { value: '2_5', label: '2 a 5' },
  { value: '6_15', label: '6 a 15' },
  { value: '16_plus', label: '16 ou mais' },
];
const APPOINTMENT_OPTIONS: OptionCard<WeeklyAppointmentsBand>[] = [
  { value: 'ate_20', label: 'Até 20' },
  { value: '21_50', label: '21 a 50' },
  { value: '51_100', label: '51 a 100' },
  { value: '100_plus', label: 'Mais de 100' },
];
const TOOLING_OPTIONS: OptionCard<CurrentTooling>[] = [
  { value: 'nada_papel', label: 'Nada ou papel' },
  { value: 'agenda_generica', label: 'Agenda genérica' },
  { value: 'outro_sistema', label: 'Outro sistema' },
];
const DISCOVERY_OPTIONS: OptionCard<DiscoverySource>[] = [
  { value: 'busca_google', label: 'Busca no Google' },
  { value: 'indicacao_colega', label: 'Indicação de um colega' },
  { value: 'redes_sociais', label: 'Redes sociais' },
  { value: 'grupo_comunidade', label: 'Grupo ou comunidade' },
  { value: 'evento', label: 'Evento ou congresso' },
  { value: 'outro', label: 'Outro' },
];

/**
 * `hint` existe só para a primeira tela. Repetir um subtítulo genérico nas
 * quatro perguntas não informa nada e rouba a hierarquia do título; o que
 * precisa ser dito — quantas perguntas são e que nenhuma pede dado pessoal —
 * precisa ser dito antes da primeira resposta, e só uma vez.
 */
const QUESTION_HEADINGS: Record<QuestionIndex, { title: string; hint?: string }> = {
  0: {
    title: 'Quantos médicos atendem na clínica?',
    hint: 'Conte apenas os médicos que atendem. Recepção, gestão e financeiro sem atendimento médico são equipe administrativa. Não pedimos dados de pacientes.',
  },
  1: { title: 'Quantos atendimentos são realizados por semana?' },
  2: { title: 'Como a clínica se organiza hoje?' },
  3: { title: 'Como você conheceu a Qoro?' },
};

const FIELD_NAMES = [
  'professionalsBand',
  'weeklyAppointmentsBand',
  'currentTooling',
  'discoverySource',
] as const satisfies readonly (keyof SignupAnswerValues)[];

function isProfessionalsBand(value: unknown): value is ProfessionalsBand {
  return value === '1' || value === '2_5' || value === '6_15' || value === '16_plus';
}
function isWeeklyAppointmentsBand(value: unknown): value is WeeklyAppointmentsBand {
  return value === 'ate_20' || value === '21_50' || value === '51_100' || value === '100_plus';
}
function isCurrentTooling(value: unknown): value is CurrentTooling {
  return value === 'nada_papel' || value === 'agenda_generica' || value === 'outro_sistema';
}
function isDiscoverySource(value: unknown): value is DiscoverySource {
  return (
    value === 'busca_google' ||
    value === 'indicacao_colega' ||
    value === 'redes_sociais' ||
    value === 'grupo_comunidade' ||
    value === 'evento' ||
    value === 'outro'
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isAnswers(value: unknown): value is SignupAnswerValues {
  if (!isRecord(value)) return false;
  return (
    isProfessionalsBand(value.professionalsBand) &&
    isWeeklyAppointmentsBand(value.weeklyAppointmentsBand) &&
    isCurrentTooling(value.currentTooling) &&
    isDiscoverySource(value.discoverySource)
  );
}
function isDraft(value: unknown): value is Draft {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.every((key) => FIELD_NAMES.some((field) => field === key)) &&
    (value.professionalsBand === undefined || isProfessionalsBand(value.professionalsBand)) &&
    (value.weeklyAppointmentsBand === undefined ||
      isWeeklyAppointmentsBand(value.weeklyAppointmentsBand)) &&
    (value.currentTooling === undefined || isCurrentTooling(value.currentTooling)) &&
    (value.discoverySource === undefined || isDiscoverySource(value.discoverySource))
  );
}
function clearLocalDraft(): void {
  try {
    window.localStorage.removeItem(LOCAL_DRAFT_KEY);
  } catch {
    // O cadastro continua funcional quando o navegador bloqueia armazenamento local.
  }
}
function readLocalDraft(): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (
      !isRecord(stored) ||
      stored.version !== 1 ||
      typeof stored.expiresAt !== 'number' ||
      !Number.isFinite(stored.expiresAt) ||
      stored.expiresAt <= Date.now() ||
      stored.expiresAt > Date.now() + LOCAL_DRAFT_TTL_MS ||
      !isDraft(stored.answers)
    ) {
      clearLocalDraft();
      return null;
    }
    return { answers: stored.answers, expiresAt: stored.expiresAt };
  } catch {
    clearLocalDraft();
    return null;
  }
}
function writeLocalDraft(answers: Draft): void {
  try {
    const expiresAt = readLocalDraft()?.expiresAt ?? Date.now() + LOCAL_DRAFT_TTL_MS;
    window.localStorage.setItem(
      LOCAL_DRAFT_KEY,
      JSON.stringify({ version: 1, expiresAt, answers }),
    );
  } catch {
    // Falta de quota ou armazenamento bloqueado não pode interromper o cadastro.
  }
}
function firstUnansweredQuestion(answers: Draft): QuestionIndex {
  const missing = FIELD_NAMES.findIndex((field) => answers[field] === undefined);
  return (missing === -1 ? QUESTION_COUNT - 1 : missing) as QuestionIndex;
}
function isSessionStatus(value: unknown): value is SignupSessionStatus {
  return (
    value === 'initiated' ||
    value === 'details_complete' ||
    value === 'identity_pending' ||
    value === 'email_pending' ||
    value === 'email_verified' ||
    value === 'blocked' ||
    value === 'expired'
  );
}
function isSession(value: unknown): value is SignupSessionState {
  if (!isRecord(value)) return false;
  return (
    isSessionStatus(value.status) &&
    typeof value.riskLevel === 'number' &&
    typeof value.expiresAt === 'string' &&
    typeof value.rowVersion === 'number' &&
    Number.isInteger(value.rowVersion) &&
    value.rowVersion >= 1 &&
    (value.emailDelivery === undefined ||
      ['pending', 'delivered', 'delayed', 'failed'].includes(String(value.emailDelivery))) &&
    (value.answers === null || isAnswers(value.answers))
  );
}
async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function SignupQuestions({
  identityEnabled = false,
  pilot = false,
}: {
  identityEnabled?: boolean;
  pilot?: boolean;
}) {
  const pilotToken = useRef<string | null>(null);
  const [pilotIdentity, setPilotIdentity] = useState<
    { ownerName: string; clinicName: string; email: string } | undefined
  >();
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SignupSessionState | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<'danger' | 'warning' | 'success'>('danger');
  const [saving, setSaving] = useState(false);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [questionIndex, setQuestionIndex] = useState<QuestionIndex>(0);
  // Só em memória, só nesta aba (ver o prop `email` de SignupEmailPending).
  const [emailPendente, setEmailPendente] = useState<string | undefined>(undefined);
  const continuationCredentials = useRef<ContinuationCredentials | null>(null);
  const startedRef = useRef(false);
  const submitInFlight = useRef(false);

  const expireSession = useCallback(() => {
    continuationCredentials.current = null;
    clearLocalDraft();
    setSession(null);
    setPhase('expired');
    setMessage('Esta sessão expirou. Inicie novamente para responder com segurança.');
    setMessageKind('warning');
  }, []);

  const hydrateSession = useCallback(
    (next: SignupSessionState, restoreLocal = true) => {
      const localDraft =
        restoreLocal && next.status === 'initiated' && next.answers === null
          ? readLocalDraft()
          : null;
      const nextDraft = next.answers ?? localDraft?.answers ?? EMPTY_DRAFT;
      if (next.answers || next.status !== 'initiated') clearLocalDraft();
      setSession(next);
      setDraft(nextDraft);
      setQuestionIndex(firstUnansweredQuestion(nextDraft));
      setMessage(
        next.status === 'email_pending' || next.status === 'email_verified'
          ? null
          : next.status === 'identity_pending' && !identityEnabled
            ? 'Dados salvos; criação da conta ainda indisponível. Nenhum e-mail de confirmação foi enviado.'
            : next.answers
              ? 'Carregamos as respostas salvas nesta sessão.'
              : null,
      );
      setMessageKind('success');
      setPhase('ready');
    },
    [identityEnabled],
  );

  const bootstrap = useCallback(
    async (turnstileToken?: string) => {
      setPhase('loading');
      setMessage(null);
      try {
        if (pilot && !pilotToken.current) {
          pilotToken.current = readOnboardingInviteToken(window.location.hash);
          if (window.location.hash)
            window.history.replaceState(null, '', PILOT_SIGNUP_PATH + window.location.search);
        }
        if (!pilot) {
          const current = await fetch('/api/signup/sessions/me', { cache: 'no-store' });
          const currentBody = await responseBody(current);
          if (current.ok && isSession(currentBody?.session)) {
            hydrateSession(currentBody.session);
            return;
          }
          if (current.status !== 410) {
            if (current.status === 429) {
              setMessage('Muitas consultas em pouco tempo. Aguarde um minuto e tente novamente.');
              setMessageKind('warning');
            } else {
              setMessage('Não foi possível consultar seu cadastro agora. Tente novamente.');
              setMessageKind('danger');
            }
            setPhase('unavailable');
            return;
          }
        }
        const created = await fetch(pilot ? '/api/signup/pilot' : '/api/signup/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(turnstileToken ? { turnstileToken } : {}),
            ...(pilot && pilotToken.current ? { inviteToken: pilotToken.current } : {}),
          }),
        });
        const createdBody = await responseBody(created);
        if (created.status === 201 && isSession(createdBody?.session)) {
          if (pilot) {
            if (pilotToken.current) {
              // The invite has become a Secure/HttpOnly cookie. Start from a
              // clean document so the router cannot restore its initial hash.
              pilotToken.current = null;
              window.location.replace(PILOT_SIGNUP_PATH + window.location.search);
              return;
            }
            const identity = createdBody?.identity;
            if (
              !isRecord(identity) ||
              typeof identity.ownerName !== 'string' ||
              typeof identity.clinicName !== 'string' ||
              typeof identity.email !== 'string'
            )
              throw new Error('Invalid pilot response');
            setPilotIdentity({
              ownerName: identity.ownerName,
              clinicName: identity.clinicName,
              email: identity.email,
            });
          }
          // Um 201 identifica uma sessão nova. Respostas locais da sessão
          // anterior não podem atravessar esse limite silenciosamente.
          const resumedPilot = pilot && createdBody?.resumed === true;
          if (!resumedPilot) clearLocalDraft();
          hydrateSession(createdBody.session, resumedPilot);
          return;
        }
        if (created.status === 401 && createdBody?.error === 'challenge_required') {
          setMessage('Conclua a verificação de segurança para iniciar.');
          setMessageKind('warning');
          setChallengeAttempt((attempt) => attempt + (turnstileToken ? 1 : 0));
          setPhase('challenge');
          return;
        }
        if (pilot && [403, 409, 410].includes(created.status)) {
          setMessage(
            created.status === 409
              ? 'Este convite já iniciou um cadastro. Continue no navegador original; se não tiver acesso a ele, fale com o responsável pelo convite.'
              : 'O convite está indisponível ou expirou. Peça ao responsável para conferir o cadastro antes de iniciar outra tentativa.',
          );
          setMessageKind('warning');
          setPhase('unavailable');
          return;
        }
        if (created.status === 429) {
          setMessage('Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.');
          setMessageKind('warning');
        } else if (created.status === 503) {
          setMessage('O cadastro está temporariamente cheio. Tente novamente em alguns minutos.');
          setMessageKind('warning');
        } else if (created.status === 403) {
          setMessage('Não foi possível iniciar o cadastro nesta conexão.');
          setMessageKind('danger');
        } else {
          setMessage('Não foi possível iniciar seu cadastro agora. Tente novamente.');
          setMessageKind('danger');
        }
        setPhase('unavailable');
      } catch {
        setMessage('A conexão falhou. Confira sua internet e tente novamente.');
        setMessageKind('danger');
        setPhase('unavailable');
      }
    },
    [hydrateSession, pilot],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrap();
  }, [bootstrap]);

  /**
   * Espera pela confirmação feita em outro aparelho.
   *
   * O intervalo e o teto não são estéticos: `GET /me` tem limite de 120
   * requisições por 15 min POR IP, compartilhado com as outras abas e com quem
   * mais estiver atrás do mesmo NAT. A 10 s a própria espera estouraria o
   * limite antes da metade do TTL absoluto e passaria a receber 429 justamente
   * enquanto a pessoa aguarda. A 20 s são no máximo 45 leituras por janela de
   * 15 min. A espera termina quando o servidor confirma ou encerra a sessão;
   * parar aos 10 min quebrava o caso real de quem abre o e-mail mais tarde.
   */
  useEffect(() => {
    if (phase !== 'ready' || session?.status !== 'email_pending') return;
    let active = true;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch('/api/signup/sessions/me', { cache: 'no-store' });
          const body = await responseBody(response);
          if (!active) return;
          if (response.ok && isSession(body?.session)) hydrateSession(body.session);
          // 410 é a sessão morta de verdade: insistir só gastaria o limite e
          // deixaria a tela mentindo que ainda há uma espera em andamento.
          else if (response.status === 410) {
            window.clearInterval(interval);
            expireSession();
          }
        } catch {
          // A tela de espera continua utilizável; o próximo ciclo tenta de novo.
        }
      })();
    }, CONFIRMATION_POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [expireSession, hydrateSession, phase, session?.status]);

  function answer<K extends keyof SignupAnswerValues>(field: K, value: SignupAnswerValues[K]) {
    const next = { ...draft, [field]: value };
    writeLocalDraft(next);
    setDraft(next);
    setMessage(null);
  }

  async function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = new FormData(event.currentTarget).get('captchaToken');
    if (typeof token !== 'string' || token.length === 0) {
      setMessage('A verificação ainda não foi concluída. Aguarde e tente novamente.');
      setMessageKind('warning');
      return;
    }
    await bootstrap(token);
  }

  async function reconcileSession(reason: 'conflict' | 'uncertain') {
    try {
      const response = await fetch('/api/signup/sessions/me', { cache: 'no-store' });
      const body = await responseBody(response);
      if (response.ok && isSession(body?.session)) {
        hydrateSession(body.session);
        setMessage(
          body.session.status === 'email_pending'
            ? 'A solicitação está em espera. Não repetimos automaticamente a criação da conta.'
            : reason === 'conflict'
              ? 'Outra aba salvou primeiro. Carregamos aqui a versão mais recente.'
              : 'A criação da conta não foi confirmada. Revise os dados antes de tentar novamente.',
        );
        setMessageKind('warning');
      } else if (response.status === 410) {
        expireSession();
      } else if (response.status === 429) {
        setMessage(
          reason === 'conflict'
            ? 'Outra aba salvou primeiro, mas a releitura atingiu o limite. Aguarde um minuto e tente novamente.'
            : 'O resultado não foi confirmado e a releitura atingiu o limite. Aguarde antes de tentar novamente.',
        );
        setMessageKind('warning');
      } else {
        setMessage(
          reason === 'conflict'
            ? 'Outra aba salvou primeiro, mas não foi possível carregar a versão mais recente. Tente novamente.'
            : 'O resultado não foi confirmado. Recarregue o cadastro antes de fazer uma nova tentativa.',
        );
        setMessageKind('danger');
      }
    } catch {
      setMessage(
        reason === 'conflict'
          ? 'Outra aba salvou primeiro, mas a conexão falhou durante a releitura. Tente novamente.'
          : 'A conexão falhou e o resultado não foi confirmado. Recarregue antes de tentar novamente.',
      );
      setMessageKind('danger');
    }
  }

  async function refreshAfterConflict() {
    await reconcileSession('conflict');
  }

  async function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Etapas já congeladas (identidade, espera, confirmado) nem renderizam as
    // perguntas: os ramos acima saem antes. Aqui sobra impedir envio duplo.
    if (!session || submitInFlight.current) return;
    const missing = FIELD_NAMES.find((field) => draft[field] === undefined);
    if (missing) {
      document.querySelector<HTMLInputElement>(`input[name="${missing}"]`)?.focus();
      setMessage('Marque uma opção em cada pergunta para continuar.');
      setMessageKind('warning');
      return;
    }
    if (!isAnswers(draft)) return;
    const submittedAnswers = draft;

    submitInFlight.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/signup/sessions/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...submittedAnswers, rowVersion: session.rowVersion }),
      });
      const body = await responseBody(response);
      if (
        response.ok &&
        typeof body?.rowVersion === 'number' &&
        Number.isInteger(body.rowVersion) &&
        body.rowVersion >= 1
      ) {
        clearLocalDraft();
        setDraft(submittedAnswers);
        setSession({
          ...session,
          status: 'details_complete',
          rowVersion: body.rowVersion,
          answers: submittedAnswers,
        });
        setMessage(
          identityEnabled
            ? 'Respostas salvas. Preencha seus dados e confirme o aceite abaixo.'
            : 'Respostas salvas. A etapa de criação da conta será conectada na próxima fatia.',
        );
        setMessageKind('success');
      } else if (response.status === 409) {
        await refreshAfterConflict();
      } else if (response.status === 410) {
        expireSession();
      } else if (response.status === 429) {
        setMessage('Muitas tentativas em pouco tempo. Aguarde um minuto antes de salvar.');
        setMessageKind('warning');
      } else {
        setMessage('Não foi possível salvar suas respostas. Tente novamente.');
        setMessageKind('danger');
      }
    } catch {
      setMessage(
        'A conexão falhou antes da confirmação. Suas escolhas continuam nesta tela; tente novamente.',
      );
      setMessageKind('danger');
    } finally {
      submitInFlight.current = false;
      setSaving(false);
    }
  }

  if (phase !== 'ready') {
    return (
      <SignupStage step={1}>
        <PublicHeading
          title={phase === 'loading' ? 'Preparando seu cadastro' : 'Vamos retomar daqui'}
          lead={
            <p aria-live="polite">
              {phase === 'loading'
                ? 'Estamos abrindo uma sessão curta e segura. Nenhum dado pessoal é solicitado nesta etapa.'
                : message}
            </p>
          }
        />
        <PublicBlock narrow>
          {phase === 'loading' ? (
            <div
              aria-label="Carregando"
              className="mx-auto size-6 animate-spin rounded-full border-2 border-border border-t-primary"
            />
          ) : phase === 'challenge' ? (
            <form onSubmit={submitChallenge} className={styles.form}>
              <TurnstileWidget action="signup_start" resetSignal={challengeAttempt} />
              <Button type="submit" className={signupFrame.buttonFull}>
                Continuar
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              onClick={() => void bootstrap()}
              className={signupFrame.buttonFull}
            >
              {phase === 'expired' ? 'Começar novamente' : 'Tentar novamente'}
            </Button>
          )}
          {phase === 'expired' ? (
            <p className={cn(signupFrame.note, 'text-center')}>
              Já recebeu um e-mail ou criou sua conta?{' '}
              <a
                href="/cadastro/retomar"
                className={cn(signupFrame.inlineLink, 'underline underline-offset-4')}
              >
                Recuperar meu cadastro por e-mail
              </a>
            </p>
          ) : null}
        </PublicBlock>
      </SignupStage>
    );
  }

  if (session?.status === 'email_verified' && session.verificationFlowVersion === 2) {
    return (
      <SignupStage step={2}>
        <PublicHeading
          title="E-mail confirmado"
          lead="Continue para a próxima etapa do seu cadastro. Não é preciso definir sua senha novamente."
        />
        <PublicBlock narrow>
          <Button
            className={signupFrame.buttonFull}
            onClick={() => window.location.assign('/cadastro/confirmado')}
          >
            Continuar cadastro
          </Button>
        </PublicBlock>
      </SignupStage>
    );
  }
  if (session?.status === 'email_verified') {
    return (
      <SignupStage step={2}>
        <SignupEmailVerified
          rowVersion={session.rowVersion}
          preparedCredentials={continuationCredentials.current}
          onCredentialsCleared={() => {
            continuationCredentials.current = null;
          }}
          onReconcile={reconcileSession}
          onGone={expireSession}
          onCompleted={() => window.location.assign('/cadastro/plano')}
        />
      </SignupStage>
    );
  }

  if (session?.status === 'email_pending') {
    return (
      <SignupStage step={2}>
        {message ? (
          <div className={cn(styles.notice, styles.noticeNarrow)}>
            <Alert variant={messageKind}>{message}</Alert>
          </div>
        ) : null}
        {session.verificationFlowVersion === 2 ? (
          <SignupCodeConfirmation
            rowVersion={session.rowVersion}
            email={emailPendente}
            deliveryStatus={session.emailDelivery}
            onEmailCorrected={
              pilot
                ? undefined
                : (rowVersion, email) => {
                    continuationCredentials.current = null;
                    setEmailPendente(email);
                    setSession({
                      ...session,
                      status: 'identity_pending',
                      rowVersion,
                      emailDelivery: 'pending',
                    });
                    setMessage(
                      'Endereço corrigido. Nome, clínica e respostas foram preservados. Informe a senha para continuar com este endereço.',
                    );
                    setMessageKind('success');
                  }
            }
            onUpdated={(rowVersion) => setSession({ ...session, rowVersion })}
            onReconcile={reconcileSession}
            onGone={expireSession}
          />
        ) : (
          <SignupEmailPending
            rowVersion={session.rowVersion}
            email={emailPendente}
            onUpdated={(rowVersion) => setSession({ ...session, rowVersion })}
            onReconcile={reconcileSession}
            onGone={expireSession}
          />
        )}
      </SignupStage>
    );
  }

  if (identityEnabled && session?.answers) {
    return (
      <SignupStage step={2}>
        {message ? (
          <div className={styles.notice}>
            <Alert variant={messageKind}>{message}</Alert>
          </div>
        ) : null}
        <SignupIdentity
          key={session.rowVersion}
          rowVersion={session.rowVersion}
          saved={session.status === 'identity_pending'}
          initialEmail={emailPendente}
          pilotIdentity={pilotIdentity}
          onCredentialsPrepared={(email) => {
            continuationCredentials.current = { email };
            setEmailPendente(email);
          }}
          onCredentialsCleared={() => {
            continuationCredentials.current = null;
          }}
          onEmailPending={(rowVersion, email) => {
            setEmailPendente(email);
            setSession({
              ...session,
              status: 'email_pending',
              rowVersion,
              verificationFlowVersion: 2,
            });
            setMessage(null);
          }}
          onReconcile={reconcileSession}
          onGone={expireSession}
        />
      </SignupStage>
    );
  }

  if (session?.answers) {
    return (
      <SignupStage step={2}>
        <PublicHeading title="Respostas salvas" />
        <PublicBlock narrow>
          <Alert variant={message ? messageKind : 'success'}>
            {message ?? 'A próxima etapa do cadastro ainda não está disponível neste ambiente.'}
          </Alert>
        </PublicBlock>
      </SignupStage>
    );
  }

  const currentField = FIELD_NAMES[questionIndex];
  const currentValue = draft[currentField];
  const handleQuestionSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (questionIndex === QUESTION_COUNT - 1) {
      void submitAnswers(event);
      return;
    }
    event.preventDefault();
    if (currentValue === undefined) {
      document.querySelector<HTMLInputElement>(`input[name="${currentField}"]`)?.focus();
      setMessage('Escolha uma opção para continuar.');
      setMessageKind('warning');
      return;
    }
    setMessage(null);
    setQuestionIndex((questionIndex + 1) as QuestionIndex);
  };

  const question = QUESTION_HEADINGS[questionIndex];

  return (
    <SignupStage step={1} showLogin>
      <form onSubmit={handleQuestionSubmit} className={styles.stack}>
        <PublicHeading
          id="signup-question-title"
          eyebrow={
            <>
              Pergunta {questionIndex + 1} de {QUESTION_COUNT}
            </>
          }
          title={question.title}
          lead={question.hint}
        />
        <PublicBlock role="group" aria-labelledby="signup-question-title">
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Progresso do perfil da clínica"
            aria-valuemin={1}
            aria-valuemax={QUESTION_COUNT}
            aria-valuenow={questionIndex + 1}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${((questionIndex + 1) / QUESTION_COUNT) * 100}%` }}
            />
          </div>

          {questionIndex === 0 ? (
            <OptionCardGroup<ProfessionalsBand>
              name="professionalsBand"
              aria-label="Quantidade de médicos"
              value={draft.professionalsBand}
              onValueChange={(value) => answer('professionalsBand', value)}
              options={PROFESSIONAL_OPTIONS}
              disabled={saving}
              className={cn(signupFrame.options)}
            />
          ) : null}
          {questionIndex === 1 ? (
            <OptionCardGroup<WeeklyAppointmentsBand>
              name="weeklyAppointmentsBand"
              aria-label="Atendimentos por semana"
              value={draft.weeklyAppointmentsBand}
              onValueChange={(value) => answer('weeklyAppointmentsBand', value)}
              options={APPOINTMENT_OPTIONS}
              disabled={saving}
              className={cn(signupFrame.options)}
            />
          ) : null}
          {questionIndex === 2 ? (
            <OptionCardGroup<CurrentTooling>
              name="currentTooling"
              aria-label="Ferramenta atual"
              value={draft.currentTooling}
              onValueChange={(value) => answer('currentTooling', value)}
              options={TOOLING_OPTIONS}
              disabled={saving}
              className={cn(signupFrame.optionsSingle)}
            />
          ) : null}
          {questionIndex === 3 ? (
            <OptionCardGroup<DiscoverySource>
              name="discoverySource"
              aria-label="Como conheceu a Qoro"
              value={draft.discoverySource}
              onValueChange={(value) => answer('discoverySource', value)}
              options={DISCOVERY_OPTIONS}
              disabled={saving}
              className={cn(signupFrame.options)}
            />
          ) : null}

          <div className={styles.closing}>
            <div aria-live="polite" className={styles.live}>
              {message ? <Alert variant={messageKind}>{message}</Alert> : null}
            </div>
            <div className={signupFrame.actions}>
              {questionIndex > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2"
                  onClick={() => {
                    setMessage(null);
                    setQuestionIndex((questionIndex - 1) as QuestionIndex);
                  }}
                >
                  <ArrowLeft aria-hidden="true" className="size-4" /> Voltar
                </Button>
              ) : (
                <span
                  className={cn(signupFrame.fine, 'inline-flex items-center gap-2 text-pretty')}
                >
                  <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
                  Sessão protegida e temporária
                </span>
              )}
              <Button type="submit" loading={saving} className="min-w-40 gap-2">
                {questionIndex === QUESTION_COUNT - 1 ? 'Salvar e continuar' : 'Continuar'}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        </PublicBlock>
      </form>
    </SignupStage>
  );
}
