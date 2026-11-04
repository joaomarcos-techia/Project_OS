import { signupRecoveryBridgeResponse } from '@/lib/http/signup-recovery-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(): Response {
  return signupRecoveryBridgeResponse();
}
