'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Switch — Radix estilizado pelo DS v2 (§switch). */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5.5 w-9.5 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-(--dur-base) ease-out',
        'bg-border-strong data-[state=checked]:bg-primary',
        'focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4.5 rounded-full bg-neutral-0 shadow-[0_1px_2px_oklch(0.3_0.02_100/0.25),0_0_0_0.5px_oklch(0.3_0.02_100/0.06)]',
          'transition-transform duration-(--dur-base) ease-(--ease-spring) data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
