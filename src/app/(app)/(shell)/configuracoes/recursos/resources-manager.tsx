'use client';

import { DoorOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import {
  createSchedulableResource,
  setSchedulableResourceActive,
} from '@/contexts/scheduling/config-actions';
import { unwrapAction } from '@/contexts/scheduling/action-result';
import type { SchedulableResourceDTO } from '@/contexts/scheduling/types';
import { uuidv4 } from '@/lib/ui/uuid';

const TYPE_LABEL: Record<SchedulableResourceDTO['type'], string> = {
  room: 'Sala',
  equipment: 'Equipamento',
  other: 'Outro',
};

export function ResourcesManager({ initial }: { initial: SchedulableResourceDTO[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<SchedulableResourceDTO['type']>('room');
  const [showInactive, setShowInactive] = useState(false);
  const [busy, startTransition] = useTransition();
  const visible = useMemo(
    () => initial.filter((resource) => showInactive || resource.active),
    [initial, showInactive],
  );

  function create() {
    if (!name.trim()) {
      toast.error('Informe o nome do recurso.');
      return;
    }
    startTransition(async () => {
      try {
        await unwrapAction(createSchedulableResource({ name: name.trim(), type }, uuidv4()));
        setName('');
        toast.success('Recurso cadastrado.');
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Erro ao cadastrar recurso.');
      }
    });
  }

  function setActive(resource: SchedulableResourceDTO, active: boolean) {
    startTransition(async () => {
      try {
        await unwrapAction(setSchedulableResourceActive(resource.id, active, uuidv4()));
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Erro ao atualizar recurso.');
      }
    });
  }

  return (
    <div className="flex max-w-190 flex-col gap-(--sp-4)">
      <Card className="p-(--card-pad)">
        {/* Rótulos de verdade: o nome vinha só com placeholder, que some ao
            digitar, e o tipo tinha `aria-label` sem nada visível ao lado. */}
        <div className="grid items-end gap-(--sp-4) sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
          <Field label="Nome" htmlFor="recurso-nome">
            <Input
              id="recurso-nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sala de ultrassom"
              maxLength={120}
            />
          </Field>
          <Field label="Tipo" htmlFor="recurso-tipo">
            <Select
              id="recurso-tipo"
              value={type}
              onChange={(event) => setType(event.target.value as SchedulableResourceDTO['type'])}
            >
              <option value="room">Sala</option>
              <option value="equipment">Equipamento</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <Button type="button" onClick={create} loading={busy}>
            Cadastrar
          </Button>
        </div>
      </Card>

      <label className="flex cursor-pointer items-center gap-2 text-(length:--fs-body-sm) text-fg-muted">
        <Checkbox
          checked={showInactive}
          onCheckedChange={(value) => setShowInactive(value === true)}
        />
        Mostrar inativos
      </label>

      <TableWrap>
        {visible.length === 0 ? (
          <EmptyState
            icon={<DoorOpen />}
            title="Nenhuma sala ou equipamento"
            description="Cadastre os recursos que a agenda pode reservar."
          />
        ) : (
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recurso</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{resource.name}</span>
                        {!resource.active ? <Badge tone="gray">Inativo</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-fg-muted">{TYPE_LABEL[resource.type]}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setActive(resource, !resource.active)}
                        >
                          {resource.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </TableWrap>
    </div>
  );
}
