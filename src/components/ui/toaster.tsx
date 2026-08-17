'use client';

import { CircleAlert, CircleCheck, Info, Sparkles, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/ui/cn';
import { dismissToast, useToasts, type ToastVariant } from './use-toast';

const ICONS: Record<ToastVariant, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
  ai: Sparkles,
};

const ICON_COLOR: Record<ToastVariant, string> = {
  success: 'text-success-600 dark:text-success-200',
  error: 'text-danger-600 dark:text-danger-200',
  info: 'text-info-600 dark:text-info-200',
  ai: 'text-ai',
};

const BAR_COLOR: Record<ToastVariant, string> = {
  success: 'bg-success-500',
  error: 'bg-danger-500',
  info: 'bg-info-500',
  ai: 'bg-ai',
};

/**
 * Região de toasts — DS v2 §toast. Montar UMA vez por shell (layout do painel
 * e do admin). Os toasts são disparados via `toast.*()` de use-toast.ts.
 */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-label="Notificações"
      role="region"
      className="fixed right-5.5 bottom-5.5 z-(--z-toast) flex w-90 max-w-[calc(100vw-32px)] flex-col-reverse gap-2.5"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            className="relative grid animate-toast-in grid-cols-[auto_1fr_auto] items-start gap-3 overflow-hidden rounded-(--r-md) border border-border-2 bg-surface p-3.5 shadow-(--elev-popover)"
          >
            <Icon
              aria-hidden="true"
              className={cn('mt-px size-5 shrink-0', ICON_COLOR[t.variant])}
            />
            <div className="min-w-0">
              {/* Só vira link quando há destino. Um <a> sem href ou um botão
                  que não navega seria um alvo de clique que não faz nada. O
                  clique dispensa junto: ao chegar no destino o aviso perdeu a
                  função e ficaria sobreposto à tela que ele pediu para abrir. */}
              {t.href ? (
                <Link
                  href={t.href}
                  onClick={() => dismissToast(t.id)}
                  className="block rounded-(--r-xs) after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="text-(length:--fs-sm) font-semibold">{t.title}</span>
                  {t.description ? (
                    <span className="mt-0.5 block text-(length:--fs-xs) text-fg-muted">
                      {t.description}
                    </span>
                  ) : null}
                </Link>
              ) : (
                <>
                  <div className="text-(length:--fs-sm) font-semibold">{t.title}</div>
                  {t.description ? (
                    <div className="mt-0.5 text-(length:--fs-xs) text-fg-muted">
                      {t.description}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="Dispensar"
              onClick={() => dismissToast(t.id)}
              // `relative`+z: o overlay do link cobre o card inteiro, e sem
              // isto o X ficaria embaixo dele e nunca receberia o clique.
              className="relative z-10 grid size-6 place-items-center rounded-(--r-xs) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
            <span
              aria-hidden="true"
              className={cn(
                'absolute bottom-0 left-0 h-0.5 animate-toast-bar',
                BAR_COLOR[t.variant],
              )}
              style={{ animationDuration: `${t.duration}ms` }}
            />
          </div>
        );
      })}
    </div>
  );
}
