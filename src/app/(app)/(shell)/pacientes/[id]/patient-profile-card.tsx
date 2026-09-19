'use client';

import { Pencil, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { updatePatientForm } from '../actions';
import { PatientForm } from '../patient-form';

export interface PatientProfileView {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  dataNascimento: string | null;
  sexo: 'M' | 'F' | 'O' | 'N' | null;
  updatedAt: string;
  obitoEm: string | null;
}

export interface PatientAddressView {
  logradouro: string;
  complemento?: string | null;
  cidade: string;
  estado: string;
  cep: string;
}

const SEX_LABEL: Record<NonNullable<PatientProfileView['sexo']>, string> = {
  M: 'Masculino',
  F: 'Feminino',
  O: 'Outro',
  N: 'Não informado',
};

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

function addressLabel(address: PatientAddressView | null): string {
  if (!address) return '—';
  return [
    [address.logradouro, address.complemento].filter(Boolean).join(', '),
    [address.cidade, address.estado].filter(Boolean).join('/'),
    address.cep ? `CEP ${address.cep}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-border/70 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-(length:--fs-sm) text-fg">{children}</dd>
    </div>
  );
}

/**
 * Identidade + contato em view mode. A edição abre na própria superfície para
 * manter contexto e evitar modal; o Server Action e o compare-and-swap do form
 * permanecem inalterados.
 */
export function PatientProfileCard({
  patient,
  address,
  canEdit,
}: {
  patient: PatientProfileView;
  address: PatientAddressView | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const phoneHref = patient.telefone?.replace(/\D/g, '') ?? null;

  return (
    <Card data-patient-section="identity" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-(--card-pad) py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-balance text-(length:--fs-h4) font-semibold">Resumo do paciente</h2>
            <Badge tone={patient.obitoEm ? 'red' : 'green'} dot>
              {patient.obitoEm ? 'Falecido' : 'Ativo'}
            </Badge>
          </div>
          <p className="mt-1 text-pretty text-(length:--fs-xs) text-fg-muted">
            Identidade e canais de contato usados na operação clínica.
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant={editing ? 'ghost' : 'secondary'}
            size="sm"
            className="min-h-(--hit-target)"
            aria-expanded={editing}
            aria-controls="patient-profile-editor"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? (
              <X aria-hidden="true" className="size-4" />
            ) : (
              <Pencil aria-hidden="true" className="size-4" />
            )}
            {editing ? 'Cancelar edição' : 'Editar dados'}
          </Button>
        ) : null}
      </div>

      <Separator />

      <dl className="grid px-(--card-pad) sm:grid-cols-2 sm:gap-x-6">
        <Detail label="CPF">
          <span className="font-mono">{patient.cpf}</span>
        </Detail>
        <Detail label="Nascimento">
          <span className="tabular-nums">{dateLabel(patient.dataNascimento)}</span>
        </Detail>
        <Detail label="Telefone">
          {patient.telefone && phoneHref ? (
            <a
              href={`tel:${phoneHref}`}
              className="inline-flex min-h-(--hit-target) items-center font-mono text-primary underline-offset-4 hover:underline"
            >
              {patient.telefone}
            </a>
          ) : (
            '—'
          )}
        </Detail>
        <Detail label="E-mail">
          {patient.email ? (
            <a
              href={`mailto:${patient.email}`}
              className="inline-flex min-h-(--hit-target) max-w-full items-center truncate text-primary underline-offset-4 hover:underline"
            >
              {patient.email}
            </a>
          ) : (
            '—'
          )}
        </Detail>
        <Detail label="Sexo">{patient.sexo ? SEX_LABEL[patient.sexo] : '—'}</Detail>
        <Detail label="Endereço">{addressLabel(address)}</Detail>
      </dl>

      {editing ? (
        <div id="patient-profile-editor">
          <Separator />
          <div className="p-(--card-pad)">
            <div className="mb-4">
              <h3 className="text-balance text-(length:--fs-sm) font-semibold">
                Editar dados cadastrais
              </h3>
              <p className="mt-1 text-pretty text-(length:--fs-xs) text-fg-muted">
                Salve apenas as informações confirmadas com o paciente.
              </p>
            </div>
            <PatientForm
              mode="edit"
              action={updatePatientForm}
              initial={{
                id: patient.id,
                updatedAt: patient.updatedAt,
                nome: patient.nome,
                telefone: patient.telefone,
                email: patient.email,
                dataNascimento: patient.dataNascimento,
                sexo: patient.sexo,
                endereco: address,
              }}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
