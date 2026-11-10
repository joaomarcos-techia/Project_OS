'use client';

import {
  Building2,
  ChevronsUpDown,
  Laptop,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
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
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        // Na barra do topo do console (celular), com nome: um ícone sozinho
        // obrigava a adivinhar. Some com a gaveta aberta, que tem o próprio fechar.
        'inline-flex h-(--hit-target) items-center gap-1.5 rounded-(--btn-radius) border border-border bg-(--card) pr-3.5 pl-2.5 text-(length:--fs-sm) font-medium text-(--text-body) shadow-(--elev-1) nav:hidden',
        open && 'invisible',
      )}
    >
      <Menu aria-hidden="true" className="size-5" />
      <span aria-hidden="true">Menu</span>
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
      data-slot="shell-sidebar"
      data-open={open}
      className={cn(
        // Celular: gaveta branca que desliza da esquerda. Computador: coluna
        // sobre o fundo do app, fora do painel de conteúdo (mesma linguagem do
        // menu da clínica), presa ao topo enquanto a página rola.
        'fixed inset-y-0 left-0 z-(--z-drawer) flex w-(--sidebar-w) flex-col gap-(--sp-4) overflow-hidden rounded-r-(--panel-radius) bg-(--card) pt-(--sp-5)',
        'transition-transform duration-(--dur-slow) ease-out motion-reduce:transition-none',
        'nav:sticky nav:top-(--shell-gap) nav:z-(--z-sticky) nav:h-[calc(100dvh-2*var(--shell-gap))] nav:translate-x-0 nav:rounded-none nav:bg-transparent nav:pt-(--sp-2)',
        open ? 'translate-x-0 shadow-(--elev-modal) nav:shadow-none' : '-translate-x-full',
      )}
    >
      {children}
    </aside>
  );
}

export function SideNavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="nav-group-label"
      className="mb-1 block px-(--sp-3) text-(length:--fs-2xs) leading-4 font-semibold tracking-[0.06em] text-(--muted-foreground) uppercase"
    >
      {children}
    </span>
  );
}

/**
 * `nav:min-h-9` encolhe o item para 36px SÓ no desktop (o breakpoint é de
 * largura, ≥900px). Abaixo dele a sidebar é drawer de toque e mantém os 40px de
 * --hit-target. Isso tira 44px da lista e faz os 11 itens caberem sem rolagem
 * até 720px de altura, sem custo de acessibilidade onde o dedo é o ponteiro.
 */
const itemBase = cn(
  'relative flex min-h-(--hit-target) items-center gap-3 rounded-(--r-md) px-(--sp-3) py-2 text-(length:--fs-sm)',
  'nav:min-h-9 mb-0.5 transition-colors duration-(--dur-fast)',
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
      data-slot="nav-link"
      // PREFETCH DESLIGADO POR PADRÃO, de propósito.
      //
      // A sidebar lista ~11 destinos e todos são rotas dinâmicas. Com o modo
      // automático do Next, entrar em QUALQUER aba disparava um request de
      // prefetch para cada uma das outras, e cada request roda o layout do shell
      // (sessão, permissões) mais a página. Medido no Preview: o recurso mais
      // lento de `/dashboard` não era script nenhum — eram os prefetches de
      // `/documentos` (639 ms), `/agenda` (594 ms) e `/pacientes` (495 ms), e o
      // de `/caixa` chegou a 1.408 ms. Abrir uma aba custava renderizar todas.
      //
      // O custo de desligar é o primeiro clique buscar a rota; a maioria das
      // telas do shell tem `loading.tsx`, então o usuário vê o esqueleto na
      // hora. Trocar N renders de fundo por uma busca sob demanda é o negócio
      // certo — e quem quiser prefetch numa rota específica passa `prefetch`.
      prefetch={prefetch ?? false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemBase,
        // Ativo: a mesma peça do menu da clínica — cartão elevado, texto na cor
        // da marca, peso maior e uma barra à esquerda. Forma, peso e barra dizem
        // "você está aqui" sem depender só da cor (WCAG 1.4.1).
        active
          ? "bg-(--card) font-semibold text-(--text-link) shadow-[inset_0_0_0_1px_var(--border),var(--elev-1)] before:absolute before:top-1/2 before:left-0 before:h-[18px] before:w-[3px] before:-translate-y-1/2 before:rounded-r-[3px] before:bg-(--primary) before:content-['']"
          : 'text-(--nav-link-fg) hover:bg-(--rail-hover) hover:text-fg',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 [&>svg]:size-5', active ? 'text-(--text-link)' : 'text-current')}
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
      <span className="font-mono text-(length:--fs-3xs) tracking-(--tracking-label) text-fg-subtle uppercase">
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
      className="flex min-h-(--hit-target) w-full items-center justify-between rounded-(--btn-radius) px-(--sp-3) py-2 text-(length:--fs-sm) text-(--nav-link-fg) transition-colors duration-(--dur-fast) hover:bg-(--rail-hover) hover:text-fg"
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
  clinicSettingsHref,
  logoutFormId,
  showThemeControl = true,
}: {
  userName: string;
  userRole?: string;
  initials: string;
  theme: ThemePreference;
  onToggleTheme: () => void;
  accountHref?: string;
  /**
   * Perfil da clinica. So chega aqui com `manage:settings` — administrar a
   * identidade da clinica e capacidade de gestor, e por isso o destino vive
   * neste menu em vez de ocupar uma aba que todo mundo ve.
   */
  clinicSettingsHref?: string;
  logoutFormId: string;
  showThemeControl?: boolean;
}) {
  const face = themeFace(theme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="sidebar-user"
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

      <DropdownMenuContent
        side="top"
        align="start"
        // Largura do proprio gatilho (var do Radix), nao a da sidebar: o bloco
        // do usuario vive dentro de um padding, entao casar com --sidebar-w
        // fazia o menu vazar para fora da barra.
        className="w-(--radix-dropdown-menu-trigger-width)"
      >
        {clinicSettingsHref ? (
          <DropdownMenuItem asChild>
            <Link href={clinicSettingsHref}>
              <Building2 />
              Perfil da clínica
            </Link>
          </DropdownMenuItem>
        ) : null}
        {accountHref ? (
          <DropdownMenuItem asChild>
            <Link href={accountHref}>
              <ShieldCheck />
              Segurança da conta
            </Link>
          </DropdownMenuItem>
        ) : null}
        {showThemeControl ? (
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
        ) : null}
        <DropdownMenuSeparator />
        {/* O formulário fica fora do portal. Um botão de submit dentro do menu saía
            do DOM ao fechar, antes de o clique enviar, e o logout não acontecia. */}
        <DropdownMenuItem
          danger
          onSelect={() =>
            (document.getElementById(logoutFormId) as HTMLFormElement | null)?.requestSubmit()
          }
        >
          <LogOut />
          Sair
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
      data-slot="wordmark"
      aria-label="Qoro — início"
      className="flex min-h-(--hit-target) items-center px-(--sp-6)"
    >
      <Logo className="h-8 w-auto" />
    </Link>
  );
}
