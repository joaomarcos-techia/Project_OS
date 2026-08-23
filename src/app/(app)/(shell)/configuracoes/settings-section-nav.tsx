'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/ui/cn';

export interface SettingsSectionLink {
  id: string;
  label: string;
}

/**
 * Navegação contextual do hub de configurações.
 *
 * É âncora dentro da própria página, não uma segunda barra lateral: o Qoro já
 * tem UMA navegação global, e empilhar outra hierarquia permanente ao lado dela
 * transforma "onde eu configuro isso?" em duas perguntas.
 *
 * Duas formas, uma só na árvore de acessibilidade por vez (`display:none` remove
 * a outra): trilha horizontal com rolagem a partir de `sm`, e menu abaixo disso
 * — onde uma trilha de seis itens ou quebraria a linha ou esconderia metade dos
 * destinos atrás de um gesto de arrastar.
 */
export function SettingsSectionNav({ sections }: { sections: SettingsSectionLink[] }) {
  const active = useActiveSection(sections.map((section) => section.id));
  const current = sections.find((section) => section.id === active) ?? sections[0];

  if (sections.length === 0) return null;

  return (
    <nav aria-label="Seções de configurações" className="min-w-0">
      <div className="hidden max-w-full gap-0.5 overflow-x-auto overscroll-x-contain border-b border-border whitespace-nowrap sm:flex">
        {sections.map((section) => {
          const isActive = section.id === active;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(event) => goToSection(event, section.id)}
              aria-current={isActive ? 'location' : undefined}
              className={cn(
                'relative shrink-0 rounded-t-(--r-sm) px-3.5 py-2.5 text-(length:--fs-body-sm) font-medium',
                'transition-colors duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
                'after:absolute after:right-2 after:-bottom-px after:left-2 after:h-0.5 after:bg-primary after:transition-opacity',
                isActive
                  ? 'text-primary after:opacity-100'
                  : 'text-fg-muted after:opacity-0 hover:text-fg',
              )}
            >
              {section.label}
            </a>
          );
        })}
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="subtle" size="sm" className="w-full justify-between">
              {current?.label ?? 'Seções'}
              <ChevronDown aria-hidden="true" className="size-4 text-fg-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            // O menu devolve o foco ao gatilho ao fechar, o que desfaria o salto
            // para a seção. Aqui o destino do salto é quem deve ficar com o foco.
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="w-(--radix-dropdown-menu-trigger-width)"
          >
            {sections.map((section) => (
              <DropdownMenuItem key={section.id} asChild>
                <a
                  href={`#${section.id}`}
                  aria-current={section.id === active ? 'location' : undefined}
                  onClick={(event) => goToSection(event, section.id)}
                >
                  {section.label}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

/**
 * Salto suave até a seção, levando o foco junto.
 *
 * Sem o `focus()`, quem navega por teclado rolava a página mas continuava com o
 * cursor na barra — o próximo Tab voltava para o item seguinte da navegação, não
 * para a seção que acabou de pedir. Cliques com modificador seguem intocados
 * (abrir em nova aba é do navegador), e o salto respeita `prefers-reduced-motion`.
 */
function goToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    return;

  const target = document.getElementById(id);
  // Sem alvo, o href puro ainda resolve — não sequestrar o clique.
  if (!target) return;

  event.preventDefault();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
  window.history.replaceState(null, '', `#${id}`);
}

/**
 * Seção em leitura. `rootMargin` corta os 60% de baixo do viewport de propósito:
 * a seção atual é a que está sendo lida no topo, não a que acabou de assomar no
 * rodapé. Sem `IntersectionObserver` (SSR, ambiente de teste) a primeira seção
 * permanece marcada — degrada para navegação simples, nunca para nav sem estado.
 */
function useActiveSection(ids: string[]): string {
  const key = ids.join(',');
  const [active, setActive] = useState(() => ids[0] ?? '');

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (list.length === 0) return;
    setActive((current) => (list.includes(current) ? current : (list[0] ?? '')));
    if (typeof IntersectionObserver === 'undefined') return;

    const nodes = list
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = list.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [key]);

  return active;
}
