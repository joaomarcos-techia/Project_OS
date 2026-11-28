'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

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
  const formRef = useRef<HTMLFormElement>(null);

  // UX-004 — a chave nascia com `useMemo(..., [])` e NUNCA rodava. Depois de um
  // lote concluído, escolher outro JSON na mesma montagem da página reenviava a
  // MESMA chave com payload diferente, e o backend recusava, corretamente, com
  // "Idempotency key ... reused with a different payload". Uma importação
  // legítima dividida em vários arquivos exigia um reload não documentado.
  //
  // A chave agora é ESTADO: preservada durante retry/replay do lote em curso
  // (que é o que a torna exactly-once) e rotacionada só APÓS sucesso, junto com
  // a limpeza do arquivo/payload. Conflito de payload com chave antiga continua
  // fail-closed no backend — a correção é de ciclo de vida da chave, não do gate.
  const [idempotencyKey, setIdempotencyKey] = useState(() => uuidv4());

  useEffect(() => {
    if (!state.message) return;
    setIdempotencyKey(uuidv4());
    setPayload('');
    setFileError(null);
    formRef.current?.reset();
  }, [state.message]);

  return (
    <form ref={formRef} action={action} className="grid gap-5">
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
            placeholder="Motivo da importação e autorização recebida"
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
        <p className="text-sm text-muted-foreground md:col-span-2" data-help="historical-convenio">
          Atendimento antigo de convênio: inclua{' '}
          <code>&quot;billingMode&quot;: &quot;convenio&quot;</code>, o registro ANS da operadora em{' '}
          <code>&quot;insurerAnsRegistry&quot;</code> (6 dígitos, operadora já cadastrada em
          Convênios) e, se quiser, o código do plano na operadora em{' '}
          <code>&quot;planCode&quot;</code>. Ele fica só como histórico: não gera guia, cobrança nem
          recebível.
        </p>
      </div>

      {payload ? (
        <Alert variant="success">
          Arquivo validado no navegador. A validação completa e a importação atômica acontecerão no
          servidor.
        </Alert>
      ) : null}
      {fileError || state.error ? <Alert variant="danger">{fileError ?? state.error}</Alert> : null}
      {state.message ? <Alert variant="success">{state.message}</Alert> : null}

      <div>
        <Button type="submit" disabled={!payload} loading={pending}>
          Importar histórico
        </Button>
      </div>
    </form>
  );
}
