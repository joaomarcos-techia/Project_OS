'use client';

import { Check, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { cn } from '@/lib/ui/cn';
import { fieldControlClassName, fieldControlInvalidClassName } from './input';

export type ComboboxItem = { id: string; label: string; hint?: string };

/**
 * Combobox assíncrono — DS v2 §combo. Busca via callback (Server Action) com
 * debounce; teclado: ↑/↓ navegam, Enter seleciona, Esc fecha. Selecionado vira
 * chip com "trocar". Reusado por Agenda (paciente) e futuros seletores.
 */
export function Combobox({
  value,
  onSelect,
  onSearch,
  placeholder = 'Buscar…',
  minChars = 2,
  debounceMs = 200,
  emptyLabel = 'Nada encontrado.',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: {
  value: ComboboxItem | null;
  onSelect: (item: ComboboxItem | null) => void;
  onSearch: (term: string) => Promise<ComboboxItem[]>;
  placeholder?: string;
  minChars?: number;
  debounceMs?: number;
  emptyLabel?: string;
  disabled?: boolean;
  /**
   * A11Y-003 — sem `id` o `<label htmlFor>` do `Field` não alcança o input e o
   * combobox ficava sem NOME acessível, dependendo do placeholder (que não é
   * nome). Opcional para não quebrar os call-sites existentes.
   */
  id?: string;
  'aria-label'?: string;
  /**
   * UX-001/UX-005 — o `Field` liga a dica ou o erro ao controle; aqui eles chegam
   * ao `<input>` de busca, que é o que recebe o foco.
   */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}) {
  const listId = useId();
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<ComboboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  // Cache por termo (sessão do componente): repetir a digitação não re-consulta.
  const cacheRef = useRef(new Map<string, ComboboxItem[]>());

  useEffect(() => {
    const t = term.trim().toLowerCase();
    if (t.length < minChars) {
      setItems([]);
      setOpen(false);
      return;
    }
    const hit = cacheRef.current.get(t);
    if (hit) {
      setItems(hit);
      setActive(0);
      setOpen(true);
      return;
    }
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await onSearchRef.current(t);
        cacheRef.current.set(t, res);
        setItems(res);
        setActive(0);
        setOpen(true);
      });
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [term, minChars, debounceMs]);

  // fecha ao clicar fora
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  if (value) {
    return (
      <div
        role="group"
        aria-labelledby={id ? `${id}-label` : undefined}
        aria-label={id ? undefined : ariaLabel}
        className="flex h-(--control-h) items-center gap-2"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-(--r-md) border border-[color-mix(in_oklch,var(--primary)_26%,transparent)] bg-(--primary-soft) py-1 pr-1.5 pl-2.5 text-(length:--fs-sm) font-medium text-(--primary-active) dark:text-fg">
          <Check aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{value.label}</span>
          <button
            type="button"
            aria-label="Trocar seleção"
            onClick={() => onSelect(null)}
            className="grid size-5 shrink-0 place-items-center rounded-(--r-xs) transition-colors hover:bg-[color-mix(in_oklch,var(--primary)_16%,transparent)]"
          >
            <X className="size-3" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <span className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <input
          {...(id ? { id } : {})}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          {...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {})}
          {...(ariaInvalid !== undefined ? { 'aria-invalid': ariaInvalid } : {})}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => items.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const it = items[active];
              if (it) {
                onSelect(it);
                setTerm('');
                setOpen(false);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className={cn(
            fieldControlClassName,
            'pl-9',
            (ariaInvalid === true || ariaInvalid === 'true') && fieldControlInvalidClassName,
          )}
        />
      </span>
      {searching ? <p className="mt-1 text-(length:--fs-xs) text-fg-subtle">buscando…</p> : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-(--z-dropdown) mt-1.5 max-h-64 w-full animate-menu-in overflow-y-auto rounded-(--r-lg) border border-border-2 bg-surface p-1.5 shadow-(--elev-popover)"
        >
          {items.length === 0 ? (
            <li className="px-2.5 py-2 text-(length:--fs-sm) text-fg-subtle">{emptyLabel}</li>
          ) : (
            items.map((it, i) => (
              <li key={it.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onSelect(it);
                    setTerm('');
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-(--r-sm) px-2.5 py-2 text-left text-(length:--fs-sm) transition-colors',
                    i === active && 'bg-surface-hover',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint ? (
                    <span className="shrink-0 text-(length:--fs-xs) text-fg-subtle">{it.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
