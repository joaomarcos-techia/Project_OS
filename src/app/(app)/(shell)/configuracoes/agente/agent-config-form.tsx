'use client';

/**
 * RBAC-001 — formulário do comportamento do Agente de IA.
 *
 * Cada campo aqui já é lido pelo agente a cada turno (`context-builder`,
 * `provide_clinic_info`, `list_pending_payments`): não é escopo inventado para
 * fazer o permission code parecer usado.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/use-toast';
import { updateAgentConfig } from '@/contexts/ai-agent/config-actions';
import type { AgentConfigDTO } from '@/contexts/ai-agent/config-types';

export function AgentConfigForm({ initial }: { initial: AgentConfigDTO }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [canScheduleAnonymous, setCanScheduleAnonymous] = useState(initial.canScheduleAnonymous);
  const [maxDaysAhead, setMaxDaysAhead] = useState(String(initial.maxDaysAhead));
  const [canDisclosePayments, setCanDisclosePayments] = useState(
    initial.canDisclosePaymentsViaAgent,
  );
  const [especialidades, setEspecialidades] = useState(initial.especialidades.join(', '));
  const [convenios, setConvenios] = useState(initial.convenios.join(', '));

  function save() {
    startTransition(async () => {
      const result = await updateAgentConfig({
        canScheduleAnonymous,
        maxDaysAhead: Number(maxDaysAhead),
        canDisclosePaymentsViaAgent: canDisclosePayments,
        especialidades: especialidades
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        convenios: convenios
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Configuração do agente salva.');
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Agente de IA' }]}
        title="Agente de IA"
        description="O que o agente pode fazer e dizer em nome da clínica no WhatsApp."
      />
      <Card className="flex max-w-190 flex-col gap-4 p-(--card-pad)">
        <Field label="Antecedência máxima de agendamento (dias)" htmlFor="agent-max-days">
          <Input
            id="agent-max-days"
            type="number"
            min={1}
            max={180}
            value={maxDaysAhead}
            onChange={(event) => setMaxDaysAhead(event.target.value)}
            aria-describedby="agent-max-days-help"
          />
          <span id="agent-max-days-help" className="text-(length:--fs-xs) text-fg-subtle">
            Horizonte de horários que o agente oferece ao paciente.
          </span>
        </Field>

        <Field label="Especialidades" htmlFor="agent-especialidades">
          <Input
            id="agent-especialidades"
            value={especialidades}
            onChange={(event) => setEspecialidades(event.target.value)}
            placeholder="Separe por vírgula"
            aria-describedby="agent-especialidades-help"
          />
          <span id="agent-especialidades-help" className="text-(length:--fs-xs) text-fg-subtle">
            O agente usa esta lista ao responder o que a clínica atende.
          </span>
        </Field>

        <Field label="Convênios aceitos" htmlFor="agent-convenios">
          <Input
            id="agent-convenios"
            value={convenios}
            onChange={(event) => setConvenios(event.target.value)}
            placeholder="Ex.: Unimed, Bradesco Saúde, SulAmérica"
            aria-describedby="agent-convenios-help"
          />
          <span id="agent-convenios-help" className="text-(length:--fs-xs) text-fg-subtle">
            Separe por vírgula. O agente informa somente os convênios desta lista; se ficar vazio,
            ele dirá que a informação ainda não foi cadastrada.
          </span>
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-(length:--fs-sm)">
          <Checkbox
            checked={canScheduleAnonymous}
            onCheckedChange={(value) => setCanScheduleAnonymous(value === true)}
          />
          <span>
            Permitir agendamento sem cadastro prévio
            <span className="block text-(length:--fs-xs) text-fg-subtle">
              O agente pode marcar para um contato que ainda não está no cadastro.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-(length:--fs-sm)">
          <Checkbox
            checked={canDisclosePayments}
            onCheckedChange={(value) => setCanDisclosePayments(value === true)}
          />
          <span>
            Permitir que o agente informe valores de cobranças pendentes
            <span className="block text-(length:--fs-xs) text-fg-subtle">
              Desligado, o agente apenas confirma que há pendência e transfere para a equipe. O
              telefone identifica o contato, mas não prova quem é o titular.
            </span>
          </span>
        </label>

        <div>
          <Button type="button" loading={pending} onClick={save}>
            Salvar
          </Button>
        </div>
      </Card>
    </>
  );
}
