'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * D-5 fase 2 — botão "Via para assinatura": baixa a via de atendimento da guia emitida (PDF sem
 * valores, com a carteirinha mascarada) pela rota autenticada e auditada. O botão mostra o
 * andamento, o erro (em `role="alert"`) e a confirmação (em `role="status"`); quem decide o acesso
 * é a rota, não este componente.
 */
export function AttendanceCopyButton({ guideId }: { guideId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/financeiro/convenios/guias/${guideId}/via?download=1`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok || !res.headers.get('content-type')?.includes('application/pdf')) {
        setError(
          res.status === 429
            ? 'Muitos downloads em pouco tempo. Aguarde alguns minutos.'
            : res.status === 409
              ? 'Esta revisão da guia foi emitida sem os dados do impresso. Reemita a guia para gerar a via.'
              : res.status === 404
                ? 'A via não está disponível para esta guia. Atualize a página e confira seu acesso.'
                : 'Não foi possível gerar a via agora. Tente de novo em instantes.',
        );
        return;
      }
      const name = /filename="([^"]+)"/u.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'via-atendimento.pdf';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDone(true);
    } catch {
      setError('Não foi possível gerar a via agora. Confira a conexão e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-(--sp-1)">
      <Button type="button" size="sm" variant="secondary" disabled={busy} aria-busy={busy} onClick={download}>
        {busy ? 'Gerando a via…' : 'Via para assinatura'}
      </Button>
      {error ? (
        <span role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </span>
      ) : null}
      {done ? (
        <span role="status" className="text-(length:--fs-sm) text-fg-muted">
          Via baixada (PDF sem valores).
        </span>
      ) : null}
    </span>
  );
}
