/**
 * Onboarding — superfície pública (convite mágico → onboarding guiado → provisionamento).
 * App importa SEMPRE daqui (boundaries). internal/* é privado ao contexto.
 */
export { generateInviteToken, hashToken } from './internal/token';
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
export { QORO_TRIAL_DAYS } from './trial';
