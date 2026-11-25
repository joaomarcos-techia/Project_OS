'use client';

/**
 * RBAC-001 — formulário do export de auditoria tenant.
 *
 * O download é montado no cliente a partir do CSV devolvido pela Server Action:
 * assim o `clinicId` nunca trafega como parâmetro, e não há URL de export que
 * alguém possa adulterar ou compartilhar.
 */
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/use-toast';

import { exportAuditAction } from './actions';

export function AuditExportForm({
  defaultFrom,
  today,
}: {
  /** Data civil no fuso da clínica, calculada no servidor (30 dias atrás). */
  defaultFrom: string;
  /** Hoje no fuso da clínica: padrão de "Até" e limite dos dois campos. */
  today: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await exportAuditAction(from, to);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const blob = new Blob([`﻿${result.csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);

      // O corte é DECLARADO: um arquivo incompleto que se apresenta como
      // completo é pior do que não ter arquivo.
      if (result.truncated) {
        toast.error(
          `O período rende mais eventos do que cabe num export. O arquivo tem os ${result.rowCount} primeiros — reduza o intervalo e exporte em partes.`,
        );
        return;
      }
      toast.success(`${result.rowCount} evento(s) exportado(s).`);
    });
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Auditoria' }]}
        title="Auditoria"
        description="Exporte a trilha de ações da clínica em CSV."
      />
      <Card className="flex max-w-190 flex-col gap-4 p-(--card-pad)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="De" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              max={today}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Até" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="date"
              max={today}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        <p className="text-(length:--fs-xs) text-fg-subtle">
          O arquivo traz data, ação, recurso, autor e IP. O conteúdo alterado em cada ação não é
          exportado — a trilha responde quem fez o quê e quando, não qual era o dado do paciente.
        </p>
        <div>
          <Button type="button" loading={pending} onClick={download}>
            Exportar CSV
          </Button>
        </div>
      </Card>
    </>
  );
}
