'use client';

import { ChevronsUpDown, Laptop, LogOut, Menu, Moon, ShieldCheck, Sun } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Logo } from './logo';
import type { ThemePreference } from './use-theme';

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
        'fixed top-3 left-3 z-[450] grid size-(--hit-target) place-items-center rounded-(--r-md) border border-border bg-surface text-fg-muted shadow-xs nav:hidden',
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
      className="fixed inset-0 z-(--z-drawer) bg-[oklch(0.2_0.02_265/0.42)] backdrop-blur-[2px] nav:hidden"
    />
  );
}

/**
 * Moldura da sidebar: off-canvas no mobile, coluna sticky no desktop.
 *
 * `overflow-hidden` aqui e `overflow-y-auto` no <nav> de dentro: antes a barra
 * inteira rolava, entao o wordmark e o bloco do usuario saiam de vista junto com
 * a lista. Agora o chrome fica ancorado e so a navegacao rola — e ela so rola em
 * viewport curta, porque a lista foi ajustada para caber inteira em 900px.
 */
export function ShellSidebar({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-(--z-drawer) flex w-(--sidebar-w) flex-col gap-(--sp-4) overflow-hidden border-r border-border bg-surface pt-(--sp-5)',
        'transition-transform duration-(--dur-slow) ease-out',
        'nav:sticky nav:top-0 nav:z-(--z-sticky) nav:h-dvh nav:translate-x-0',
        open ? 'translate-x-0 shadow-(--elev-modal) nav:shadow-none' : '-translate-x-full',
      )}
    >
      {children}
    </aside>
  );
}

export function SideNavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block px-(--sp-3) text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
      {children}
    </span>
  );
}

const itemBase = cn(
  'relative flex min-h-(--hit-target) items-center gap-3 rounded-(--r-md) px-(--sp-3) py-2 text-(length:--fs-sm)',
  'mb-0.5 transition-colors duration-(--dur-fast)',
);

export function SideNavLink({
  href,
  active,
  icon,
  label,
  trailing,
  prefetch,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch ?? null}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemBase,
        // Ativo sem preenchimento: a referencia distingue por CONTRASTE e PESO,
        // e a pilula azul anterior gritava mais alto que o conteudo da pagina.
        // Dois sinais nao-cromaticos (cor do texto + peso) atendem 1.4.1 junto
        // com o aria-current; hover mantem o fundo porque e transitorio e some.
        active ? 'font-medium text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 [&>svg]:size-5', active ? 'text-fg' : 'text-fg-subtle')}
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
    <span
      aria-disabled="true"
      className={cn(itemBase, 'cursor-not-allowed text-fg-muted opacity-60')}
    >
      <span aria-hidden="true" className="shrink-0 text-fg-subtle [&>svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[9.5px] tracking-[0.04em] text-fg-subtle uppercase">
        {note}
      </span>
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
      className="flex min-h-(--hit-target) w-full items-center justify-between rounded-(--r-sm) px-(--sp-3) py-2 text-(length:--fs-sm) text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-hover hover:text-fg"
    >
      <span className="flex items-center gap-2 [&>svg]:size-4">
        {icon}
        <span>{label}</span>
      </span>
      {trailing}
    </button>
  );
}

/** Toggle de tema do rodapé — usado pelos dois shells. */
export function ThemeFootToggle({
  theme,
  onToggle,
}: {
  theme: ThemePreference;
  onToggle: () => void;
}) {
  const { label, icon } = themeFace(theme);

  return (
    <SidebarFootButton
      onClick={onToggle}
      aria-label={`${label}. Alternar tema`}
      icon={icon}
      label={label}
      trailing={<span className="font-mono text-(length:--fs-2xs) text-fg-subtle">⌘\</span>}
    />
  );
}

/** Rotulo e icone do ciclo de tema — compartilhado pelo menu e pelo botao solto. */
function themeFace(theme: ThemePreference) {
  if (theme === 'dark') return { label: 'Tema escuro', icon: <Moon /> };
  if (theme === 'system') return { label: 'Tema do sistema', icon: <Laptop /> };
  return { label: 'Tema claro', icon: <Sun /> };
}

/**
 * Bloco de usuario do rodape — agora o gatilho de um menu.
 *
 * Antes, tema e "Sair" eram duas linhas soltas embaixo do nome, deixando quatro
 * elementos disputando um canto que a referencia resolve com um. Eles nao
 * sumiram: viraram itens do menu, que e onde acao de conta e procurada.
 *
 * O logout continua sendo submit de <form> POST (nunca GET: logout e mutacao).
 * O form vive fora do menu e o botao o alcanca por `form=id`, porque o conteudo
 * do menu e renderizado num Portal e um form aninhado no item quebraria a
 * composicao do Radix.
 */
export function SidebarUserMenu({
  userName,
  userRole,
  initials,
  theme,
  onToggleTheme,
  accountHref,
  logoutFormId,
}: {
  userName: string;
  userRole?: string;
  initials: string;
  theme: ThemePreference;
  onToggleTheme: () => void;
  accountHref?: string;
  logoutFormId: string;
}) {
  const face = themeFace(theme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-(--hit-target) w-full items-center gap-2.5 rounded-(--r-md) px-(--sp-3) py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-hover"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--primary-soft) text-(length:--fs-sm) font-semibold text-(--primary-active) dark:text-fg">
            {initials}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-(length:--fs-sm) leading-tight font-semibold">
              {userName}
            </span>
            {userRole ? (
              <span className="truncate text-(length:--fs-xs) leading-tight text-fg-subtle">
                {userRole}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-fg-subtle" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-(--sidebar-w)">
        {accountHref ? (
          <DropdownMenuItem asChild>
            <Link href={accountHref}>
              <ShieldCheck />
              Seguranca da conta
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          // Sem o preventDefault o menu fecha a cada clique, e o tema cicla por
          // tres estados — reabrir a cada passo seria hostil.
          onSelect={(event) => {
            event.preventDefault();
            onToggleTheme();
          }}
        >
          {face.icon}
          {face.label}
          <DropdownMenuShortcut>&#8984;&#92;</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild danger>
          <button type="submit" form={logoutFormId}>
            <LogOut />
            Sair
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Wordmark da marca (Qoro) — logo enviada pelo founder (2026-07-04).
 *
 * O padding de 24px alinha a borda esquerda da logo com a coluna dos ícones: o
 * <nav> tem px-(--sp-3) e cada item tem px-(--sp-3). Com os 20px anteriores ela
 * ficava 4px fora do eixo de tudo abaixo dela.
 */
export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Qoro — início"
      className="flex min-h-(--hit-target) items-center px-(--sp-6)"
    >
      <Logo className="h-8 w-auto" />
    </Link>
  );
}
