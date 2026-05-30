// Barrel do módulo policies/. Pure functions, sem IO (D23).
export { mustEnforceAAL2, mustHaveMFA, shouldPromptMFAEnroll } from './mfa-policy';
export { postLoginRedirect, type PostLoginContext, type PostLoginRoute } from './routing-policy';
export { CRITICAL_ACTIONS } from './critical-actions';
