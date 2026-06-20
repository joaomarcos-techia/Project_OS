'use client';

import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

type ExportResult = { signedUrl: string; sha256: string; rowCount: number; expiresInDays: number };

/**
 * Export PDF de auditoria (C15). Chama o route handler GET (write-surface
 * sancionada); o PDF é gerado server-side com SHA256 e devolvido por signed URL
 * (7 dias). O ciphertext/PII nunca passa por aqui — só o link e o hash.
 */
export function ExportAuditForm({ clinicId }: { clinicId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/admin/clinicas/${clinicId}/audit/export?from=${from}&to=${to}`,
      );
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Falha ao exportar');
      else setResult(data as ExportResult);
    } catch {
      setError('Falha de rede');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={run} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-fg-muted">De</label>
          <input
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Até</label>
          <input
            type="date"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={buttonVariants({ variant: 'secondary' })}
        >
          {loading ? 'Gerando…' : 'Exportar PDF'}
        </button>
      </div>

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      {result ? (
        <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
          <a
            href={result.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-700 underline"
          >
            Baixar PDF ({result.rowCount} evento(s)) — válido por {result.expiresInDays} dias
          </a>
          <p className="mt-1 break-all font-mono text-xs text-fg-subtle">
            SHA256: {result.sha256}
          </p>
        </div>
      ) : null}
    </form>
  );
}
