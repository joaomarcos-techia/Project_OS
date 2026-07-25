'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import {
  createSchedulableResource,
  setSchedulableResourceActive,
} from '@/contexts/scheduling/config-actions';
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
        await createSchedulableResource({ name: name.trim(), type }, uuidv4());
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
        await setSchedulableResourceActive(resource.id, active, uuidv4());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Erro ao atualizar recurso.');
      }
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="cardblock wrap-pad grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome (ex.: Sala de ultrassom)"
          maxLength={120}
        />
        <select
          className="h-10 rounded-(--r-md) border border-border bg-surface px-3 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value as SchedulableResourceDTO['type'])}
          aria-label="Tipo de recurso"
        >
          <option value="room">Sala</option>
          <option value="equipment">Equipamento</option>
          <option value="other">Outro</option>
        </select>
        <Button type="button" onClick={create} loading={busy}>
          Cadastrar
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => setShowInactive(event.target.checked)}
          className="size-4"
        />
        Mostrar inativos
      </label>

      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhuma sala ou equipamento cadastrado.</p>
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {visible.map((resource) => (
              <div key={resource.id} className="listrow">
                <div className="lr-main flex items-center gap-2">
                  <span className="font-medium">{resource.name}</span>
                  <Badge tone="gray">{TYPE_LABEL[resource.type]}</Badge>
                  {!resource.active ? <Badge tone="gray">inativo</Badge> : null}
                </div>
                <div className="lr-end">
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
