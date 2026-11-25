import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

// Painel (C-UI): shell + design tokens do bundle de design (ds.css base do DS +
// app-shell.css da casca). Importados aqui (layout) p/ valerem em todas as telas
// autenticadas. globals.css (root) carrega antes; tokens compartilham linhagem.
import './_painel/ds.css';
import './_painel/app-shell.css';
import { ImpersonationBanner } from '@/components/admin/impersonation-banner';
import { visibleModuleIds } from '@/components/painel/modules';
import { PainelShell } from '@/components/painel/painel-shell';
import { getShellIdentity } from '@/components/painel/shell-identity';
import { AnnouncementPopup } from '@/components/shared/announcement-popup';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { getImpersonationView } from '@/lib/impersonation';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getActiveAnnouncement } from '@/lib/platform-announcements';
import { loadTrialAccessForRequest } from './_painel/trial-access-request';
import { TrialAccessNotice } from './_painel/trial-access-notice';
import { LastAccessNotice } from '@/app/(app)/_lib/last-access-notice';

import { HandoffWatcher } from './_painel/handoff-watcher';
import { TOUR_STEPS } from '@/contexts/onboarding';

import { currentOnboardingProgress } from './_painel/onboarding-progress';
import { ProductTour } from './_painel/product-tour';
import { firstSettingsHref, visibleSettingsNavigation } from './configuracoes/settings-navigation';

import { stopImpersonationAction } from '../../(admin)/admin/actions/impersonation';

/**
 * Layout das rotas autenticadas com chrome (sidebar). Route-group `(shell)` não
 * altera URL. Auth real é feita pelo middleware + `requireUser` nas páginas.
 * A identidade (usuário/clínica) do shell vem do profile + clinics reais.
 *
 * C15: durante impersonate, o banner permanente (OR-I9) aparece acima do shell.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const [user, id, impersonation, announcement] = await Promise.all([
    getCurrentUser(),
    getShellIdentity(),
    getImpersonationView(),
    getActiveAnnouncement(),
  ]);

  // V9 (auditoria de segurança): backstop de defesa-em-profundidade. O middleware
  // + `require*` por página são a defesa primária; este guard garante que o shell
  // NUNCA renderize para um usuário não-autenticado, mesmo que uma request fure o
  // middleware (ex.: cookie `_healed` forjado / V4) — fail-closed no layout.
  if (!user) {
    redirect('/login');
  }

  // C15: super_admin só fica no app tenant DURANTE um impersonate. Sem sessão
  // ativa (nunca iniciou / TTL expirou / revogado), volta pro /admin — em vez de
  // bater em requireClinicId() e quebrar a tela tenant (OR-I10).
  //
  // ⚠️ SÓ COM AAL2, e isto conserta um IMPASSE FECHADO (14/09). Sem a condição,
  // um super_admin recém-criado ficava trancado para fora do produto inteiro:
  //
  //   login → postLoginRedirect manda para /account/security?force=1 (sem MFA)
  //        → mas essa página vive no (shell)
  //        → o shell redireciona para /admin
  //        → /admin exige AAL2 → notFound()
  //
  // Ou seja: precisava de AAL2 para chegar na única tela que concede AAL2. O
  // `seed:super-admin` imprime "PRÓXIMOS PASSOS" que eram inalcançáveis.
  //
  // Em AAL1 o shell RENDERIZA, e é o que torna o enrollment possível. A troca
  // aceita: um super_admin em AAL1 que digite uma rota de tenant à mão cai no
  // erro de `requireClinicId()` em vez de ser redirecionado. É uma janela que
  // dura um enrollment; o custo anterior era lockout permanente.
  if (user?.isSuperAdmin && !impersonation && user.aal === 'aal2') {
    redirect('/admin');
  }

  // `/configuracoes` deixou de ser um redirect: agora é a página que empilha
  // todas as categorias. O desvio para a primeira categoria existia só para
  // evitar a race de hook-order do App Router num redirect de cliente — sem o
  // redirect, o shell aponta para o índice, que é o que a referência mostra.
  // O fallback permanece para quem não enxerga categoria nenhuma.
  const settingsGroups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );
  const settingsHref =
    settingsGroups.length > 0 ? '/configuracoes' : firstSettingsHref(settingsGroups);
  // O menu mostra só o que a pessoa consegue abrir; cada página mantém o próprio
  // gate. Mesma regra de super_admin do `pageGate` e das categorias acima.
  const allowedModuleIds = visibleModuleIds(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  // Depois do guard de `user`: a leitura abre `withTenant`, e abrir transação
  // para quem o layout vai redirecionar seria trabalho jogado fora. Memoizada
  // por request, então o dashboard reaproveita a mesma linha. Nunca cria linha.
  // P-11: as duas leituras são independentes; antes uma esperava a outra em toda página.
  const [onboarding, trialAccess] = await Promise.all([
    currentOnboardingProgress(),
    user.clinicId ? loadTrialAccessForRequest(user.clinicId) : null,
  ]);

  return (
    <>
      {announcement ? <AnnouncementPopup announcement={announcement} /> : null}
      {impersonation ? (
        <ImpersonationBanner view={impersonation} stopAction={stopImpersonationAction} />
      ) : null}
      {/* Só monta para quem atende: sem a permissão o watcher nem existe no
          cliente, então não há polling nem payload de fila para quem não pode
          ver conversa. A action reautoriza por conta própria. */}
      {user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS) ? <HandoffWatcher /> : null}
      {/* O-7 — o tour mora no shell para sobreviver à troca de rota. Só monta
          para quem tem clínica: super_admin sem impersonate nem chega aqui, e
          `onboarding_progress` é por (clínica, pessoa). */}
      {onboarding ? <ProductTour initial={onboarding} steps={TOUR_STEPS} /> : null}
      <PainelShell
        userName={id.userName}
        userRole={id.userRole}
        clinicName={id.clinicName}
        settingsHref={settingsHref}
        allowedModuleIds={allowedModuleIds}
        {...(user.permissions.includes(PERMISSIONS.MANAGE_SETTINGS)
          ? { clinicSettingsHref: '/configuracoes/perfil' }
          : {})}
      >
        <TrialAccessNotice snapshot={trialAccess} />
        {/* R42 (requisito 42 da ANS): último acesso, só no perfil TISS (componente do #55). */}
        <LastAccessNotice />
        {children}
      </PainelShell>
    </>
  );
}
