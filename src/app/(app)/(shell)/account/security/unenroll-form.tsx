'use client';

import { unenrollAction } from './actions';

export function UnenrollForm({ factorId }: { factorId: string }) {
  return (
    <form action={unenrollAction} className="flex items-center gap-2">
      <input type="hidden" name="factorId" value={factorId} />
      <span className="font-mono text-xs text-gray-600">{factorId.slice(0, 8)}…</span>
      <button
        type="submit"
        className="rounded border border-red-400 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      >
        Remover
      </button>
    </form>
  );
}
