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

function todayYmd(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function AuditExportForm() {
  const [from, setFrom] = useState(todayYmd(-30));
  const [to, setTo] = useState(todayYmd());
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
      <PageHeader crumbs={[{ label: 'Conformidade e segurança', href: '/configuracoes/seguranca' }, { label: 'Auditoria' }]} title="Auditoria" description="Exporte a trilha de ações da clínica em CSV." />
      <Card className="flex max-w-190 flex-col gap-4 p-(--card-pad)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="De" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Até" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="date"
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
