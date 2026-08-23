'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/ui/cn';

import type { SettingsNavGroup } from './settings-navigation';

export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();

  return (
    <aside className="min-w-0 lg:sticky lg:top-(--sp-5) lg:self-start">
      <nav aria-label="Configurações" className="overflow-x-auto pb-2 lg:overflow-visible lg:pb-0">
        <div className="flex w-max gap-(--sp-5) lg:w-auto lg:flex-col lg:gap-(--sp-4)">
          {groups.map((group, groupIndex) => (
            <section key={group.label} aria-labelledby={`settings-group-${groupIndex}`}>
              <h2
                id={`settings-group-${groupIndex}`}
                className="mb-1.5 whitespace-nowrap px-2 font-mono text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase"
              >
                {group.label}
              </h2>
              <div className="flex gap-1 lg:flex-col">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href.startsWith('/configuracoes/') &&
                      pathname.startsWith(`${item.href}/`));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-(--hit-target) shrink-0 items-center whitespace-nowrap rounded-(--r-md) px-2.5 text-(length:--fs-sm) font-medium',
                        'transition-[background-color,color] duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
                        // Mesma regra da navegação principal: contraste e peso,
                        // sem preenchimento. Com o menu primário quieto, a
                        // pílula azul aqui invertia a hierarquia — o submenu
                        // gritava mais alto que a navegação que o contém.
                        active
                          ? 'font-medium text-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>
    </aside>
  );
}
