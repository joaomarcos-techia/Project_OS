import { Check, ChevronDown, ChevronRight, Rocket } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

import type { ActivationChecklistDTO } from '../data';

import { ChecklistDismiss } from './checklist-dismiss';

/**
 * Checklist de ativação (Fase 2) — some quando os passos estão concluídos.
 *
 * O-7: some também quando a pessoa dispensa. São duas razões diferentes para o
 * mesmo desaparecimento — "a clínica terminou" é fato derivado do banco, "não
 * quero mais ver" é escolha de quem usa. Dispensar não marca nada como feito.
 *
 * ===================================================================
 * POR QUE O CABEÇALHO REPETE O CONTRATO DO `PanelCard` EM VEZ DE USÁ-LO
 * ===================================================================
 * Todo bloco do dashboard é um `PanelCard`, e este precisa parecer da mesma
 * família — mesmo `data-slot="panel-header"`, mesmo `<h4>` em `--fs-sm`, mesmo
 * ícone em `text-fg-subtle`. O que impede reusar o componente é a mecânica: aqui
 * o cabeçalho INTEIRO é o `<summary>` que abre e fecha o bloco, e o `PanelCard`
 * renderiza o header dentro de uma `<div>` própria, fora do alcance de quem o
 * chama. Envolver o `PanelCard` num `<summary>` colocaria o conteúdo do painel
 * dentro do gatilho — clicar em qualquer item fecharia a lista.
 *
 * `<details>` e não estado em cliente: recolher não precisa de JavaScript, e o
 * bloco é renderizado no servidor junto com o resto do dashboard.
 */
export function ActivationChecklist({
  data,
  dismissed = false,
}: {
  data: ActivationChecklistDTO;
  dismissed?: boolean;
}) {
  if (data.complete || dismissed) return null;
  const pending = data.items.find((item) => !item.done);
  const pct = data.total > 0 ? (data.done / data.total) * 100 : 0;

  return (
    <Card data-slot="activation-checklist" className="mb-(--sp-4) overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-(--sp-3) p-(--card-pad) focus-visible:shadow-(--focus-ring) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <div data-slot="panel-header" className="flex items-center justify-between gap-(--sp-3)">
            <h4 className="flex items-center gap-1.5 text-(length:--fs-sm) font-semibold [&>svg]:size-4 [&>svg]:text-fg-subtle">
              <Rocket aria-hidden="true" />
              Ativação da clínica
            </h4>
            <span className="flex shrink-0 items-center gap-(--sp-2)">
              <Badge tone="blue">
                {data.done} de {data.total}
              </Badge>
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-fg-subtle transition-transform duration-(--dur-fast) group-open:rotate-180"
              />
            </span>
          </div>

          {/* A barra ocupa a largura do card, não 20px de canto: é o indicador
              de progresso do bloco, e em miniatura ela não informava nada.
              `aria-valuetext` porque "2 de 5 passos" é o que se quer ouvir. */}
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={data.total}
            aria-valuenow={data.done}
            aria-valuetext={`${data.done} de ${data.total} passos concluídos`}
            className="block h-1.5 overflow-hidden rounded-full bg-surface-inset"
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-(--dur-base)"
              style={{ width: `${pct}%` }}
            />
          </span>

          <span className="text-pretty text-(length:--fs-xs) text-fg-muted">
            {pending ? (
              <>
                <span className="font-medium text-fg">Próximo:</span> {pending.desc}
              </>
            ) : (
              'Confira os passos de ativação.'
            )}
          </span>
        </summary>

        <ul className="flex flex-col border-t border-border px-(--card-pad)">
          {data.items.map((it) => (
            <li key={it.key} className="border-b border-border last:border-b-0">
              <Link
                href={it.href}
                className={cn(
                  'group/item flex items-center gap-(--sp-3) rounded-(--r-sm) px-(--sp-2) py-(--sp-3)',
                  'transition-colors duration-(--dur-fast) hover:bg-surface-hover',
                  'focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
                  it.done && 'opacity-60',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-4.5 shrink-0 place-items-center rounded-full',
                    it.done
                      ? 'bg-success-600 text-neutral-0'
                      : 'border-[1.5px] border-border-strong',
                  )}
                >
                  {it.done ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-(length:--fs-sm) font-medium',
                      it.done && 'line-through',
                    )}
                  >
                    {it.label}
                  </span>
                  <span className="block text-(length:--fs-xs) text-fg-subtle">{it.desc}</span>
                </span>
                {!it.done ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-fast) group-hover/item:translate-x-0.5"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        {/* Fora do <summary>: dentro dele, o clique no botão também abriria e
            fecharia o <details>, e dispensar viraria um gesto duplo. */}
        <CardFooter className="py-(--sp-2)">
          <ChecklistDismiss />
        </CardFooter>
      </details>
    </Card>
  );
}
