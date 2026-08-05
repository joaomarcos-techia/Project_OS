'use client';

import { useActionState, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

import { importAppointmentHistoryForm, type ImportHistoryState } from './actions';

const INITIAL: ImportHistoryState = { error: null, message: null };

export function HistoryImporter() {
  const [state, action, pending] = useActionState(importAppointmentHistoryForm, INITIAL);
  const [payload, setPayload] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => uuidv4(), []);

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="payload" value={payload} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Fonte dos dados
          <Input
            name="source"
            required
            minLength={2}
            maxLength={160}
            placeholder="Sistema legado / planilha 2024"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium md:col-span-2">
          Justificativa
          <Textarea
            name="justification"
            required
            minLength={5}
            maxLength={1000}
            placeholder="Motivo da importacao e autorizacao recebida"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium md:col-span-2">
          Arquivo JSON
          <Input
            type="file"
            accept="application/json,.json"
            required
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              setPayload('');
              setFileError(null);
              if (!file) return;
              if (file.size > 1_000_000) {
                setFileError('O arquivo deve ter no maximo 1 MB.');
                return;
              }
              const text = await file.text();
              try {
                const parsed = JSON.parse(text) as unknown;
                if (!Array.isArray(parsed)) throw new Error('not_array');
                setPayload(text);
              } catch {
                setFileError('Selecione um JSON valido contendo uma lista.');
              }
            }}
          />
        </label>
      </div>

      {payload ? (
        <Alert variant="success">
          Arquivo validado no navegador. A validacao completa e a importacao atomica acontecerao no
          servidor.
        </Alert>
      ) : null}
      {fileError || state.error ? <Alert variant="danger">{fileError ?? state.error}</Alert> : null}
      {state.message ? <Alert variant="success">{state.message}</Alert> : null}

      <div>
        <Button type="submit" disabled={!payload} loading={pending}>
          Importar historico
        </Button>
      </div>
    </form>
  );
}
