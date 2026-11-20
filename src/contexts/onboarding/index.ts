/**
 * Onboarding — superfície pública (convite mágico → onboarding guiado → provisionamento).
 * App importa SEMPRE daqui (boundaries). internal/* é privado ao contexto.
 */
export { generateInviteToken, hashToken } from './internal/token';
export { verifySignupTurnstileProbe } from './internal/turnstile';
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
export { confirmSignupEmailCode, resolveSignupContinuation } from './internal/signup-email-code';
export { recordSignupEmailDelivery } from './internal/signup-email-delivery';
export { restoreSignupDraftSnapshot } from './internal/signup-draft-snapshot';
export {
  prepareSignupRecovery,
  requestSignupRecovery,
  sendSignupLeadRecovery,
  consumeSignupRecovery,
  readConsumedSignupRecovery,
  completeRecoveredSignupPassword,
  signupRecoveryInputSchema,
  SIGNUP_RECOVERY_COOKIE,
} from './internal/signup-recovery';
export {
  signupEmailCodeSchema,
  readSignupCodeDestination,
} from './internal/signup-email-code-repository';
export {
  claimSignupDraftByVerifiedEmail,
  ensureSignupDraftForVerifiedEmail,
  readOwnedSignupReference,
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
  type EnsureSignupDraftOutcome,
  type OwnedSignupCredentialState,
  type OwnedSignupReferenceOutcome,
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
  signupContinuationSchema,
  signupResendSchema,
  signupEmailCorrectionSchema,
  correctSignupEmail,
  adoptVerifiedSignupForContinuation,
  readSignupContinuationIdentity,
  readReservedSignupAttemptEpoch,
  readSignupDeliveryAttemptState,
  readSignupReferenceLiveness,
  advanceSignupCredentialEpoch,
  finishSignupCredentialEpoch,
  reserveSignupAuthAttempt,
  reserveSignupResendAttempt,
  abortSignupAuthAttempt,
  abortSignupResendAttempt,
  finishSignupAuthAttempt,
  finishSignupResendAttempt,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  type SignupSessionState,
  type SignupSessionStatus,
  type SignupDeliveryAttemptState,
  type SignupReferenceLiveness,
} from './internal/signup-session';
export {
  checkSignupPasswordExposure,
  resendSignupConfirmation,
  sendSignupConfirmation,
  type SignupPasswordExposure,
  type SignupConfirmationOutcome,
} from './internal/signup-confirmation-email';
export {
  bindLegacyVerifiedSignupAppMetadata,
  createPendingSignupAppMetadata,
  deriveSignupHandoffCode,
  hasSignupAuthBindingMarker,
  isPendingSignupUserBound,
  markPasswordAuthenticatedSignupReady,
  markSignupPasswordSet,
  readPendingSignupReference,
  readSignupAuthBinding,
  readSignupPasswordState,
  rebindPendingSignupAppMetadata,
  verifySignupHandoffCode,
} from './internal/signup-auth-binding';
export {
  validateLegacySignupDeliveryCandidate,
  ensurePasswordAuthenticatedSignupAuthBinding,
  ensureReadyOwnedSignupAuthBinding,
  ensureVerifiedSignupAuthBinding,
  resolveReadyOwnedSignupOnboarding,
  resolveSignupDraftEntry,
  validateVerifiedSignupAuthUserForClaim,
  type EnsureReadyOwnedSignupAuthBindingOutcome,
  type EnsureVerifiedSignupAuthBindingOutcome,
  type ValidateLegacySignupDeliveryCandidateOutcome,
  type ValidateVerifiedSignupAuthUserOutcome,
} from './internal/signup-auth-admin';
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
export { readSignupBilling, type SignupBillingAttemptState } from './internal/signup-billing';
export {
  startSignupSubscription,
  reconcileSignupSubscription,
  type StartSignupSubscriptionOutcome,
  type ReconcileSignupSubscriptionOutcome,
} from './internal/signup-checkout';
export {
  abandonSignupHostedCheckout,
  startSignupHostedCheckout,
  completeSignupHostedCheckout,
  type AbandonSignupHostedCheckoutOutcome,
  type StartSignupHostedCheckoutOutcome,
  type CompleteSignupHostedCheckoutOutcome,
} from './internal/signup-hosted-checkout';
export {
  provisionTenantFromSignup,
  type ProvisionSignupOutcome,
} from './internal/signup-provision';
export {
  provisionFreeSignupTrial,
  type FreeSignupTrialOutcome,
} from './internal/signup-free-trial';
export {
  ONBOARDING_STEPS,
  EMPTY_STEP_STATE,
  advanceStep,
  parseStepState,
  stepStateSchema,
  type OnboardingStep,
  type StepState,
} from './internal/step-state';
/* O-7 — onboarding operacional (pos-tenant). Sai a leitura, a aplicacao de
   acao e a lista de passos; `mutate` continua privado porque cada UPDATE carrega
   a sua propria pre-condicao e chamar um deles fora de ordem e como se cria
   estado impossivel. */
export {
  TOUR_STEPS,
  TOUR_LAST_STEP,
  applyOnboardingAction,
  onboardingActionSchema,
  readOnboardingProgress,
  tourStepAt,
  type OnboardingAction,
  type OnboardingActionOutcome,
  type OnboardingProgressState,
  type TourState,
  type TourStep,
} from './internal/operational-onboarding';
export type { ClinicInviteRow, ClinicInviteInsert } from './schema';
export { formatTrialDays, QORO_SELF_SERVICE_TRIAL_DAYS, QORO_TRIAL_DAYS } from './trial';
export {
  bootstrapPilotSignup,
  readPilotSignupPlan,
  pilotPlanSelectionAllowed,
  provisionPilotSignup,
  PILOT_INVITE_COOKIE,
} from './internal/signup-pilot';
export {
  issuePilotInviteTx,
  pilotIdentitySchema,
  PilotSignupError,
} from './internal/signup-pilot-repository';
