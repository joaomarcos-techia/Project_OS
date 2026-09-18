/**
 * Onboarding — superfície pública (convite mágico → onboarding guiado → provisionamento).
 * App importa SEMPRE daqui (boundaries). internal/* é privado ao contexto.
 */
export { generateInviteToken, hashToken } from './internal/token';
export {
  CURRENT_TOOLING,
  DISCOVERY_SOURCES,
  PROFESSIONALS_BANDS,
  WEEKLY_APPOINTMENT_BANDS,
  recordSignupAnswers,
  signupAnswersSchema,
  type RecordAnswersOutcome,
  type SignupAnswers,
} from './internal/signup-answers';
export type { SignupAnswerValues } from './internal/signup-answer-values';
export {
  claimSignupDraftByVerifiedEmail,
  readSignupDraft,
  readSignupPlan,
  signupDraftMutationSchema,
  signupPlanMutationSchema,
  writeSignupDraft,
  writeSignupPlan,
  type SignupPlan,
  type SignupPlanState,
  type SignupDraftState,
  type ClaimSignupDraftOutcome,
  type WriteSignupDraftInput,
} from './internal/signup-draft';
export {
  SIGNUP_SESSION_CEILING,
  createSignupSession,
  hashSignupToken,
  getSignupSessionPressure,
  purgeExpiredSignupSessions,
  readSignupSession,
  recordSignupIdentity,
  signupIdentitySchema,
  signupAuthSchema,
  signupResendSchema,
  reserveSignupAuthAttempt,
  reserveSignupResendAttempt,
  abortSignupAuthAttempt,
  finishSignupAuthAttempt,
  finishSignupResendAttempt,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  type SignupSessionState,
  type SignupSessionStatus,
} from './internal/signup-session';
export {
  cancelInviteTx,
  createInviteTx,
  getInviteStatus,
  guardedUpdateInvite,
  listOnboardingPlans,
  resolveCheckoutPlan,
  resolveOpenInvite,
  type CheckoutPlan,
  type InviteCreateTxArgs,
  type OnboardingPlan,
} from './internal/invites';
export {
  OnboardingProvisionError,
  createOwnerUser,
  provisionTenantFromInvite,
  runCheckout,
  type CheckoutArgs,
  type ProvisionArgs,
} from './internal/saga';
/* O-5/O-6. Só a orquestração sai daqui: reserva, ativação, marcação e
   reconciliação de linha são passos INTERNOS de `signup-checkout`, e expô-los
   convidaria a chamar um deles fora de ordem — que é exatamente como se cria
   assinatura duplicada. O tipo do estado sai porque a UI precisa nomeá-lo. */
export type { SignupBillingAttemptState } from './internal/signup-billing';
export {
  startSignupSubscription,
  reconcileSignupSubscription,
  type StartSignupSubscriptionOutcome,
  type ReconcileSignupSubscriptionOutcome,
} from './internal/signup-checkout';
export {
  provisionTenantFromSignup,
  type ProvisionSignupOutcome,
} from './internal/signup-provision';
export {
  ONBOARDING_STEPS,
  EMPTY_STEP_STATE,
  advanceStep,
  parseStepState,
  stepStateSchema,
  type OnboardingStep,
  type StepState,
} from './internal/step-state';
export type { ClinicInviteRow, ClinicInviteInsert } from './schema';
export { formatTrialDays, QORO_SELF_SERVICE_TRIAL_DAYS, QORO_TRIAL_DAYS } from './trial';
