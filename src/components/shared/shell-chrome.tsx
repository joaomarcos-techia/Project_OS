'use client';

import { Menu, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Peças de chrome compartilhadas pelos shells (painel tenant e admin) —
 * DS v2 §side/side-nav, recriadas em Tailwind. Zero duplicação entre shells
 * (Governança de UI regra 5).
 */

export function MobileNavButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Abrir navegação"
      onClick={onClick}
      className={cn(
        // acima do topbar sticky (z-sticky) para o clique não ser interceptado
        'fixed top-3.5 left-3.5 z-[450] grid size-9 place-items-center rounded-(--r-md) border border-border bg-surface text-fg-muted shadow-xs lg:hidden',
        open && 'hidden',
      )}
    >
      <Menu className="size-5" />
    </button>
  );
}

export function ShellScrim({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      onClick={onClick}
      className="fixed inset-0 z-(--z-drawer) bg-[oklch(0.2_0.02_230/0.42)] backdrop-blur-[2px] lg:hidden"
    />
  );
}

/** Moldura da sidebar: off-canvas no mobile, coluna sticky no desktop. */
export function ShellSidebar({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-(--z-drawer) flex w-(--sidebar-w) flex-col gap-(--sp-4) overflow-y-auto border-r border-border bg-surface pt-(--sp-5)',
        'transition-transform duration-(--dur-slow) ease-out',
        'lg:sticky lg:top-0 lg:z-(--z-sticky) lg:h-dvh lg:translate-x-0',
        open ? 'translate-x-0 shadow-(--elev-modal) lg:shadow-none' : '-translate-x-full',
      )}
    >
      {children}
    </aside>
  );
}

export function SideNavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block px-(--sp-3) font-mono text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
      {children}
    </span>
  );
}

const itemBase = cn(
  'relative flex items-center gap-2.5 rounded-(--r-md) px-(--sp-3) py-2 text-(length:--fs-sm)',
  'mb-0.5 transition-colors duration-(--dur-fast)',
);

export function SideNavLink({
  href,
  active,
  icon,
  label,
  trailing,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemBase,
        active
          ? 'bg-(--primary-soft) font-medium text-(--primary-active) dark:text-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 [&>svg]:size-4.5', active ? 'text-primary dark:text-fg' : 'text-fg-subtle')}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

/** Item desabilitado ("Em breve") — UX honesta: nunca link morto. */
export function SideNavDisabled({
  icon,
  label,
  note = 'em breve',
}: {
  icon: ReactNode;
  label: ReactNode;
  note?: string;
}) {
  return (
    <span aria-disabled="true" className={cn(itemBase, 'cursor-not-allowed text-fg-muted opacity-60')}>
      <span aria-hidden="true" className="shrink-0 text-fg-subtle [&>svg]:size-4.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[9.5px] tracking-[0.04em] text-fg-subtle uppercase">{note}</span>
    </span>
  );
}

/** Botão do rodapé da sidebar (toggle de tema, sair). */
export function SidebarFootButton({
  onClick,
  type = 'button',
  icon,
  label,
  trailing,
  'aria-label': ariaLabel,
}: {
  onClick?: () => void;
  type?: 'button' | 'submit';
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full items-center justify-between rounded-(--r-sm) px-(--sp-3) py-2 text-(length:--fs-sm) text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-hover hover:text-fg"
    >
      <span className="flex items-center gap-2.25 [&>svg]:size-3.75">
        {icon}
        <span>{label}</span>
      </span>
      {trailing}
    </button>
  );
}

/** Toggle de tema do rodapé — usado pelos dois shells. */
export function ThemeFootToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <SidebarFootButton
      onClick={onToggle}
      aria-label="Alternar tema"
      icon={dark ? <Moon /> : <Sun />}
      label={dark ? 'Tema escuro' : 'Tema claro'}
      trailing={<span className="font-mono text-[10.5px] text-fg-subtle">⌘\</span>}
    />
  );
}

/** Wordmark ClinicaOS — DS v2 §wordmark (nome display + selo "OS"). */
export function Wordmark({ logo }: { logo: ReactNode }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-(--sp-5)">
      {logo}
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-[19px] font-semibold tracking-(--tracking-tight)">
          Clinica
        </span>
        <span className="rounded-(--r-xs) bg-primary px-1.25 py-0.5 font-mono text-[11px] font-medium tracking-[0.04em] text-on-primary">
          OS
        </span>
      </span>
    </Link>
  );
}
