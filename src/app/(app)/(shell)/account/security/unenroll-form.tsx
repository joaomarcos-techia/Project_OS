'use client';

import { Button } from '@/components/ui/button';

import { unenrollAction } from './actions';

export function UnenrollForm({ factorId }: { factorId: string }) {
  return (
    <form action={unenrollAction} className="flex items-center gap-2">
      <input type="hidden" name="factorId" value={factorId} />
      <span className="font-mono text-xs text-fg-muted">{factorId.slice(0, 8)}…</span>
      <Button type="submit" variant="danger" size="sm">
        Remover
      </Button>
    </form>
  );
}
