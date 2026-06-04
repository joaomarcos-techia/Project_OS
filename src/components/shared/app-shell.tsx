'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { AppSidebar } from './app-sidebar';

/**
 * App shell — sidebar 268px + conteúdo (DS §app shell). Desktop: grid sticky.
 * Mobile (<lg): sidebar vira drawer com scrim + botão de menu.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Fecha o drawer ao navegar.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[268px_1fr]">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegação"
        className="fixed left-4 top-4 z-50 inline-flex size-10 items-center justify-center rounded-md border border-border bg-surface text-fg shadow-md lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-[280px] overflow-y-auto border-r border-border bg-surface transition-transform duration-300 ease-out',
          'lg:sticky lg:top-0 lg:z-40 lg:w-auto lg:translate-x-0 lg:bg-surface/[0.78] lg:shadow-none lg:backdrop-blur-[12px]',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar navegação"
          className="absolute right-3 top-4 inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-inset lg:hidden"
        >
          <X className="size-4" />
        </button>
        <AppSidebar onNavigate={() => setOpen(false)} />
      </aside>

      <main className="min-w-0 overflow-x-clip">
        <div className="mx-auto max-w-[1080px] px-6 pb-12 pt-16 lg:px-10 lg:pt-8">{children}</div>
      </main>
    </div>
  );
}
