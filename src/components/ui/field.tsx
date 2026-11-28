import { CircleAlert } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

type FieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  /**
   * Use para conjuntos de controles relacionados (radio group, checkboxes etc.).
   * Nesse modo o rótulo vira um `legend`, em vez de um `label` sem controle.
   */
  group?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

type ControlAria = {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: unknown;
  'aria-required'?: unknown;
};

/**
 * Agrupa label + controle + hint/erro — DS v2 §fields.
 * Erro substitui o hint (comportamento do DS: `.field.invalid`).
 *
 * Acessibilidade (UX-001, `docs/otimização_ui_final.md`): o texto de ajuda ou de
 * erro ganha `id` e passa a descrever o controle (`aria-describedby`); com erro,
 * o controle fica `aria-invalid`; com `required`, `aria-required`. Isso só é
 * aplicado quando o filho é o próprio controle (`id === htmlFor`): wrappers e
 * filhos compostos ficam como estão. Em `group`, a descrição vai no `fieldset`.
 * Atributos já passados pelo chamador nunca são sobrescritos.
 */
export function Field({
  label,
  htmlFor,
  group = false,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const base = htmlFor ?? `field${autoId}`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  let control: ReactNode = children;
  if (!group && htmlFor && isValidElement(children)) {
    const element = children as ReactElement<ControlAria>;
    const props = element.props;
    if (props.id === htmlFor) {
      const merged = [props['aria-describedby'], describedBy].filter(Boolean).join(' ');
      const extra: ControlAria = {};
      if (merged && merged !== props['aria-describedby']) extra['aria-describedby'] = merged;
      if (error && props['aria-invalid'] === undefined) extra['aria-invalid'] = true;
      if (required && !props.required && props['aria-required'] === undefined) {
        extra['aria-required'] = true;
      }
      if (Object.keys(extra).length > 0) control = cloneElement(element, extra);
    }
  }

  const content = (
    <>
      {label ? (
        group ? (
          <legend className="text-(length:--fs-sm) font-medium text-fg">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-1.5 text-danger-600">
                *
              </span>
            ) : null}
          </legend>
        ) : (
          <label
            id={htmlFor ? `${htmlFor}-label` : undefined}
            htmlFor={htmlFor}
            className="flex items-center gap-1.5 text-(length:--fs-sm) font-medium text-fg"
          >
            {label}
            {required ? (
              <span aria-hidden="true" className="text-danger-600">
                *
              </span>
            ) : null}
          </label>
        )
      ) : null}
      {control}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-(length:--fs-xs) text-danger-600">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-(length:--fs-xs) text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </>
  );

  if (group) {
    return (
      <fieldset
        aria-describedby={describedBy}
        className={cn('m-0 flex min-w-0 flex-col gap-(--field-gap) border-0 p-0', className)}
      >
        {content}
      </fieldset>
    );
  }

  return <div className={cn('flex flex-col gap-(--field-gap)', className)}>{content}</div>;
}
