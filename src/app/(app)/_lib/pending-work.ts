/**
 * S2 — trabalho pendente que precisa ir ao servidor ANTES de a sessão ser bloqueada (hoje: o autosave do
 * prontuário). O editor registra uma função que salva o que falta e diz se ficou tudo salvo; o guarda de
 * inatividade chama `flushPendingWork` no aviso (9 min, sessão ainda ativa) e de novo no bloqueio.
 *
 * Nada aqui guarda conteúdo: o texto clínico continua só no estado do editor e no banco (nunca em
 * localStorage/sessionStorage, que ficariam para o próximo usuário da máquina).
 */
export type PendingFlush = () => Promise<boolean>;

const pending = new Set<PendingFlush>();

export function registerPendingWork(flush: PendingFlush): () => void {
  pending.add(flush);
  return () => {
    pending.delete(flush);
  };
}

/** `true` = tudo salvo (ou nada pendente); `false` = algo falhou ou passou do prazo. */
export async function flushPendingWork(timeoutMs = 5_000): Promise<boolean> {
  if (pending.size === 0) return true;
  const all = Promise.all([...pending].map((flush) => flush().catch(() => false)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean[]>((resolve) => {
    timer = setTimeout(() => resolve([false]), timeoutMs);
  });
  try {
    return (await Promise.race([all, timeout])).every(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

/** Só para testes. */
export function pendingWorkCount(): number {
  return pending.size;
}
