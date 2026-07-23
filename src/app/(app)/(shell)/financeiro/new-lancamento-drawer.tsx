'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import type { PaymentMethodDTO, SupplierSummary } from '@/contexts/financial/types';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

import { LancamentoForm } from './lancamento-form';

/**
 * Criação de lançamento em Drawer (rota /financeiro/lancamentos/novo aposentada).
 * Deep-linkable: /financeiro?novo=1. Sucesso: a action redireciona p/ /financeiro.
 */
export function NewLancamentoDrawer({
  suppliers,
  methods,
  defaultOpen = false,
}: {
  suppliers: SupplierSummary[];
  methods: PaymentMethodDTO[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Sincroniza a URL SEM re-navegar. `router.replace('/financeiro?novo=1')`
  // disparava o RSC force-dynamic e rebuscava a lista inteira de lançamentos só
  // para abrir um drawer (lentidão — item 15). `history.replaceState` mantém o
  // deep-link (`defaultOpen` no 1º load) e o back/forward sem refetch.
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', v ? '/financeiro?novo=1' : '/financeiro');
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" />
          Novo lançamento
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Novo lançamento</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <p className="mb-4 text-(length:--fs-sm) text-fg-muted">
            Conta a receber ou a pagar (origem manual).
          </p>
          <LancamentoForm suppliers={suppliers} methods={methods} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
