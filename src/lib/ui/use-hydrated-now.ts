'use client';

import { useEffect, useState } from 'react';

/**
 * "Agora" seguro para hidratação (R51). Componente cliente que calcula "há X min",
 * "aguardando há…" ou "atrasado" com `Date.now()` durante a renderização produz um HTML no
 * servidor e outro no navegador, que hidrata segundos depois: quando a virada de um minuto
 * cai entre os dois, o React acusa erro 418 (texto ou estrutura diferente) e refaz a árvore.
 *
 * Devolve `null` no servidor e na PRIMEIRA renderização do navegador (as duas iguais), e
 * o instante real logo depois de montar, atualizado a cada `intervalMs`. Quem usa mostra o
 * valor neutro enquanto for `null` (sem número inventado).
 */
export function useHydratedNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
