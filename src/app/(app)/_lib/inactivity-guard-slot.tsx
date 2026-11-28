import { readTissFootprintLazy } from '@/app/(app)/_lib/tiss-footprint';
import { isInTissPasswordScope } from '@/lib/auth/security-profile/password-policy';
import { INACTIVITY_LIMIT_MS, INACTIVITY_WARN_MS } from '@/lib/auth/security-profile/tiss-policies';
import { isTissProfileEnforced } from '@/lib/auth/security-profile/tiss-scope';
import { SESSION_ACTIVITY_RENEW_THROTTLE_MS } from '@/lib/auth/session-activity';
import { authenticate } from '@/lib/auth/tenant-context';

import { InactivityGuard } from './inactivity-guard';
import { lockSessionAction, registerSessionActivityAction } from './session-activity-actions';

/**
 * S2 — monta o guarda de inatividade só para quem está no alcance do perfil TISS (perfil ligado; clínica com dado
 * TISS ou módulo ligado; impersonação herda o alcance da clínica). Fora disso não renderiza nada e não custa nada.
 */
export async function InactivityGuardSlot() {
  if (!isTissProfileEnforced(process.env)) return null;
  const auth = await authenticate();
  if (!auth.ok) return null;
  if (!(await isInTissPasswordScope(auth.identity.clinicId, readTissFootprintLazy))) return null;
  return (
    <InactivityGuard
      warnMs={INACTIVITY_WARN_MS}
      limitMs={INACTIVITY_LIMIT_MS}
      renewThrottleMs={SESSION_ACTIVITY_RENEW_THROTTLE_MS}
      registerActivity={registerSessionActivityAction}
      lockSession={lockSessionAction}
    />
  );
}
