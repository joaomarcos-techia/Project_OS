'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

/**
 * "Atualizar" do cabeçalho — refaz o RSC no lugar, sem recarregar a página.
 *
 * O Dashboard é `force-dynamic` e não faz polling: quem está de olho no turno
 * precisa de uma forma explícita de puxar o estado novo, e F5 perderia a
 * posição de rolagem. `useTransition` mantém a tela viva durante o refetch em
 * vez de piscar o skeleton.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={() => start(() => router.refresh())}
      aria-label="Atualizar os dados do turno"
    >
      {pending ? null : <RefreshCw aria-hidden="true" className="size-4 text-fg-subtle" />}
      Atualizar
    </Button>
  );
}
