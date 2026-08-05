import type { ImpersonationView } from '@/lib/impersonation';

/**
 * Banner permanente de impersonate (C15, OR-I9). Renderizado em TODA tela tenant
 * enquanto a sessão estiver ativa. Não fecha, não esconde, não tem dismiss.
 *
 * Componente PURO (review #9): recebe a `view` (do módulo de impersonate) e a
 * `stopAction` por prop — não importa auth/tenant-context. Sticky no topo para
 * permanecer visível durante o scroll.
 */
export function ImpersonationBanner({
  view,
  stopAction,
}: {
  view: ImpersonationView;
  stopAction: () => Promise<void>;
}) {
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-center justify-between gap-4 bg-danger-600 px-4 py-2 text-sm text-white shadow-md"
    >
      <span>
        Você está visualizando a clínica <strong>{view.clinicNome}</strong> como Super Admin. Todas
        as ações estão sendo auditadas.
      </span>
      <form action={stopAction}>
        <button
          type="submit"
          className="shrink-0 rounded-md border border-white/40 px-3 py-1 text-xs font-medium hover:bg-white/10"
        >
          Encerrar impersonate
        </button>
      </form>
    </div>
  );
}
