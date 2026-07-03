'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

import { createPatientForm } from './actions';
import { PatientForm } from './patient-form';

/**
 * Criação de paciente em Drawer (escada de navegação — a rota /pacientes/novo
 * foi aposentada). Deep-linkable: /pacientes?novo=1 abre o drawer.
 * No sucesso a action redireciona para /pacientes/[id] (drawer some junto).
 */
export function NewPatientDrawer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    // mantém a URL espelhando o estado (back fecha o drawer; link é compartilhável)
    router.replace(v ? '/pacientes?novo=1' : '/pacientes', { scroll: false });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" />
          Novo paciente
        </Button>
      </DrawerTrigger>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>Novo paciente</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <PatientForm mode="create" action={createPatientForm} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
