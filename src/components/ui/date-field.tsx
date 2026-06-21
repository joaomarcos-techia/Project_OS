'use client';

import { useState, type CSSProperties } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Campo de data BR — exibe/aceita **dd/mm/aaaa** (com máscara), independente do
 * locale do navegador, e envia o valor em **ISO (aaaa-mm-dd)** num `<input hidden>`
 * com o `name` — então o backend continua recebendo o mesmo formato de antes
 * (era o que o `type="date"` mandava). Substitui o `type="date"` nativo, cujo
 * formato de exibição é ditado pelo idioma do navegador (mostrava mm/dd/aaaa).
 */
function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function brToIso(v: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return '';
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function mask(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function DateField({
  name,
  defaultValue = '',
  required = false,
  disabled = false,
  className,
  style,
  id,
  'aria-label': ariaLabel,
}: {
  name: string;
  /** Valor inicial em ISO (aaaa-mm-dd) ou ''. */
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  'aria-label'?: string;
}) {
  const [display, setDisplay] = useState(() => isoToBr(defaultValue));
  const iso = brToIso(display);

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={display}
        onChange={(e) => setDisplay(mask(e.target.value))}
        required={required}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
        className={cn(className ?? 'input')}
        style={style}
      />
      {/* Valor real enviado no form: ISO (vazio se incompleto/ inválido). */}
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
