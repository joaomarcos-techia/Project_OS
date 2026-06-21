'use client';

import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

type ExportResult = { signedUrl: string; sha256: string; rowCount: number; expiresInDays: number };

/** dd/mm/aaaa → aaaa-mm-dd (ISO). null se inválido. */
function brToIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = Number(dd);
  const mo = Number(mm);
  const y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1970) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Máscara: só dígitos → dd/mm/aaaa enquanto digita. */
function maskBrDate(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * Allowlist de esquema p/ usar uma URL num `href` sem risco de DOM XSS
 * (`javascript:`/`data:` executariam ao clicar). A signedUrl vem do servidor
 * (Supabase Storage = https), mas validamos aqui no cliente como defesa em
 * profundidade: só http/https passa; qualquer outra coisa → null (não renderiza).
 */
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Export PDF de auditoria (C15). Datas em **dd/mm/aaaa** (BR garantido, sem
 * depender do locale do navegador) — convertidas p/ ISO ao chamar o endpoint.
 * O PDF é gerado server-side (SHA256 + signed URL 7d); ciphertext/PII nunca passa
 * por aqui — só o link e o hash.
 */
export function ExportAuditForm({ clinicId }: { clinicId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const fromIso = brToIso(from);
    const toIso = brToIso(to);
    if (!fromIso || !toIso) {
      setError('Use o formato dd/mm/aaaa nas duas datas.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/admin/clinicas/${clinicId}/audit/export?from=${fromIso}&to=${toIso}`,
        { method: 'POST' },
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

  const downloadHref = result ? safeHttpUrl(result.signedUrl) : null;

  return (
    <form onSubmit={run} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-fg-muted">De</label>
          <input
            inputMode="numeric"
            placeholder="dd/mm/aaaa"
            maxLength={10}
            value={from}
            onChange={(e) => setFrom(maskBrDate(e.target.value))}
            className="input w-32"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-fg-muted">Até</label>
          <input
            inputMode="numeric"
            placeholder="dd/mm/aaaa"
            maxLength={10}
            value={to}
            onChange={(e) => setTo(maskBrDate(e.target.value))}
            className="input w-32"
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
          {downloadHref ? (
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-700 underline"
            >
              Baixar PDF ({result.rowCount} evento(s)) — válido por {result.expiresInDays} dias
            </a>
          ) : (
            <span className="text-danger-600">Link de download inválido.</span>
          )}
          <p className="mt-1 break-all font-mono text-xs text-fg-subtle">SHA256: {result.sha256}</p>
        </div>
      ) : null}
    </form>
  );
}
