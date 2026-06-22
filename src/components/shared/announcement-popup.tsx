'use client';

/**
 * Pop-up ÚNICO de aviso da plataforma (C15 · Platform Settings). Substitui o banner superior fixo:
 * aparece UMA vez por usuário (localStorage), com título + corpo, e é dispensável.
 * Software clínico não "para" — então isto é só comunicação, nunca bloqueio.
 *
 * Texto puro (React escapa). Lógica de "já vi?" vive em announcement-dismissal
 * (pura, testada); aqui só o I/O com localStorage (try/catch) + o modal.
 */
import { useEffect, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import {
  ANNOUNCEMENT_SEEN_KEY,
  addSeen,
  parseSeen,
  shouldShowAnnouncement,
} from './announcement-dismissal';

export interface AnnouncementPopupData {
  id: string;
  title: string | null;
  message: string;
  level: string;
}

export function AnnouncementPopup({ announcement }: { announcement: AnnouncementPopupData }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen: string[] = [];
    try {
      seen = parseSeen(localStorage.getItem(ANNOUNCEMENT_SEEN_KEY));
    } catch {
      /* sem localStorage → mostra (fail-open é ok p/ comunicação) */
    }
    if (shouldShowAnnouncement(announcement.id, seen)) setOpen(true);
  }, [announcement.id]);

  if (!open) return null;

  const dismiss = () => {
    try {
      const seen = parseSeen(localStorage.getItem(ANNOUNCEMENT_SEEN_KEY));
      localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, JSON.stringify(addSeen(seen, announcement.id)));
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const warn = announcement.level === 'warning';
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
        <div className="mb-1.5 flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${warn ? 'bg-warning-500' : 'bg-primary-500'}`} />
          <h3 className="text-base font-semibold text-fg">{announcement.title || 'Aviso'}</h3>
        </div>
        <p className="whitespace-pre-wrap text-sm text-fg-muted">{announcement.message}</p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={dismiss} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
