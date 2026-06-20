/**
 * Guard ÚNICO do Platform Admin (C15).
 *
 * Regra absoluta (OR-A1/A2): só `super_admin` com AAL2 acessa `/admin/*`.
 * Qualquer outra condição → `notFound()` (404). NUNCA redirect/401/403 — não
 * vazamos a existência do painel a não-super_admin.
 *
 * `requireSuperAdmin()` já exige isSuperAdmin && aal === 'aal2'; aqui só
 * traduzimos a falha em 404. Chamado no layout E no topo de cada page/route
 * (D22: layouts não protegem route handlers; toda entrada revalida).
 *
 * Read-only: o painel não tem Server Actions de mutação de dados de clínica.
 * As ÚNICAS escritas vivem em `admin/actions/{impersonation,exports}.ts`. Isso é
 * garantido estruturalmente + por arch test (admin-read-only.test) — não por um
 * check de runtime frágil (review #11).
 *
 * Server-only.
 */
import 'server-only';

import { notFound } from 'next/navigation';

import { requireSuperAdmin } from '@/lib/auth/tenant-context';

export async function guardAdminAccess(): Promise<void> {
  try {
    await requireSuperAdmin();
  } catch {
    notFound();
  }
}
