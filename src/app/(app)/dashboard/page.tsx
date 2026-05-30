/**
 * /dashboard — placeholder C3. Renderiza o estado de autorização do user logado
 * para validar testes 3.6.1 / 3.6.2 / 3.6.8.
 *
 * Em C5+ vira home real da clínica (overview, agenda do dia, etc).
 */
import Link from 'next/link';

import { requireUser } from '@/lib/auth/tenant-context';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Dashboard (placeholder C3)</h1>

      <nav className="mb-6 flex gap-3">
        <Link
          href="/pacientes"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white"
        >
          Pacientes →
        </Link>
      </nav>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium">userId</dt>
        <dd className="font-mono">{user.userId}</dd>
        <dt className="font-medium">clinicId</dt>
        <dd className="font-mono">{user.clinicId ?? '(null — super_admin)'}</dd>
        <dt className="font-medium">role</dt>
        <dd className="font-mono">{user.role}</dd>
        <dt className="font-medium">isSuperAdmin</dt>
        <dd className="font-mono">{String(user.isSuperAdmin)}</dd>
        <dt className="font-medium">aal</dt>
        <dd className="font-mono">{user.aal ?? '(null)'}</dd>
        <dt className="font-medium">claimsVersion</dt>
        <dd className="font-mono">{user.claimsVersion}</dd>
        <dt className="font-medium align-top">permissions</dt>
        <dd className="font-mono break-all">{user.permissions.join(', ') || '(empty)'}</dd>
      </dl>

      <form action="/logout" method="post" className="mt-6">
        <button className="rounded bg-black px-3 py-2 text-sm font-medium text-white">
          Logout
        </button>
      </form>
    </main>
  );
}
