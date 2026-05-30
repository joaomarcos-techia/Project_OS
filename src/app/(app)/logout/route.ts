/**
 * POST /logout
 *
 * signOut({scope:'global'}) revoga refresh token server-side (D24). access
 * token permanece válido até expirar (max 15min com D12 — TTL config Supabase).
 * Documentado como gap conhecido em ADR-009 + runbook c3-validation.
 */
import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/auth/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}
