'use client';

import { ClipboardList, FileText, Pill, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';

import { buscarPacientesParaDocumento } from './actions';

type Destination = {
  href: (patientId: string) => string;
  title: string;
  description: string;
  icon: typeof ClipboardList;
};

export function NewClinicalDocumentDrawer({
  canCreateProntuario,
  canCreateDocument,
}: {
  canCreateProntuario: boolean;
  canCreateDocument: boolean;
}) {
  const [patient, setPatient] = useState<ComboboxItem | null>(null);

  const destinations: Destination[] = [
    ...(canCreateProntuario
      ? [
          {
            href: (patientId: string) => `/pacientes/${patientId}?tab=prontuarios`,
            title: 'Prontuário',
            description: 'Abrir o histórico e iniciar um novo registro longitudinal.',
            icon: ClipboardList,
          },
        ]
      : []),
    ...(canCreateDocument
      ? [
          {
            href: (patientId: string) => `/pacientes/${patientId}?novo=prescricao`,
            title: 'Prescrição',
            description: 'Emitir uma receita com validação das credenciais profissionais.',
            icon: Pill,
          },
          {
            href: (patientId: string) => `/pacientes/${patientId}?novo=documento`,
            title: 'Documento médico',
            description: 'Emitir atestado, declaração, pedido de exame ou encaminhamento.',
            icon: FileText,
          },
        ]
      : []),
  ];

  return (
    <Drawer onOpenChange={(open) => !open && setPatient(null)}>
      <DrawerTrigger asChild>
        <Button size="sm" className="min-h-(--hit-target)">
          <Plus className="size-4" />
          Novo documento
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="flex-col items-start pr-14">
          <DrawerTitle>Novo documento clínico</DrawerTitle>
          <DrawerDescription>
            Selecione o paciente e o tipo. Este fluxo não cria uma consulta artificial.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-(--sp-5)">
          <Field label="Paciente" htmlFor="clinical-document-patient">
            <Combobox
              id="clinical-document-patient"
              aria-label="Buscar paciente"
              value={patient}
              onSelect={setPatient}
              onSearch={buscarPacientesParaDocumento}
              placeholder="Digite ao menos 2 caracteres"
              emptyLabel="Nenhum paciente ativo encontrado."
            />
          </Field>

          {patient ? (
            <section aria-labelledby="clinical-document-kind">
              <h3 id="clinical-document-kind" className="text-(length:--fs-sm) font-semibold">
                O que deseja criar?
              </h3>
              <div className="mt-2 grid gap-2">
                {destinations.map((destination) => {
                  const Icon = destination.icon;
                  return (
                    <DrawerClose asChild key={destination.title}>
                      <Link
                        href={destination.href(patient.id)}
                        className="group flex min-h-16 items-center gap-3 rounded-(--r-md) border border-border bg-surface px-3.5 py-3 text-left transition-colors duration-(--dur-fast) hover:border-border-2 hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-(--r-sm) bg-(--primary-soft) text-primary">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-(length:--fs-sm) font-semibold text-fg">
                            {destination.title}
                          </span>
                          <span className="mt-0.5 block text-pretty text-(length:--fs-xs) text-fg-muted">
                            {destination.description}
                          </span>
                        </span>
                      </Link>
                    </DrawerClose>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="border-t border-border pt-3">
            <DrawerClose asChild>
              <Link
                href="/pacientes?novo=1"
                className="inline-flex min-h-(--hit-target) items-center gap-2 text-(length:--fs-sm) font-medium text-primary hover:underline"
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Cadastrar novo paciente
              </Link>
            </DrawerClose>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
