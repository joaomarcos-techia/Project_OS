'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { copiarLinkDeCobrancaAction } from './actions';

type CopyState =
  | { kind: 'idle' }
  | { kind: 'copied' }
  | { kind: 'manual'; url: string }
  | { kind: 'error'; message: string };

const FALHA = 'Não foi possível obter o link agora. Tente de novo.';

/** A action respondeu que o link não vale mais; a mensagem dela vai para a tela. */
class LinkIndisponivel extends Error {}

/**
 * Escreve no clipboard sem perder o gesto do usuário. `ClipboardItem` recebe a
 * PROMESSA do texto, e o navegador espera a action dentro do clique; o Safari
 * recusa `writeText` chamado depois de um `await`.
 */
async function writeToClipboard(url: Promise<string>): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await clipboard.write([
      new ClipboardItem({
        'text/plain': url.then((text) => new Blob([text], { type: 'text/plain' })),
      }),
    ]);
    return;
  }
  if (clipboard?.writeText) {
    await clipboard.writeText(await url);
    return;
  }
  throw new Error('clipboard_unavailable');
}

/**
 * "Copiar link" do sinal ou do saldo que a Meta não entregou.
 *
 * O link é buscado no CLIQUE, nunca no render: ele não fica no HTML da Agenda e
 * só sai enquanto a cobrança for pagável. Sem clipboard (permissão negada,
 * navegador antigo), o link aparece num campo para copiar à mão.
 */
export function CopyChargeLinkButton({ jobId, label }: { jobId: string; label: string }) {
  const [state, setState] = useState<CopyState>({ kind: 'idle' });
  const [pending, setPending] = useState(false);

  async function copy() {
    setPending(true);
    setState({ kind: 'idle' });
    const url = copiarLinkDeCobrancaAction(jobId).then((result) => {
      if (!result.ok) throw new LinkIndisponivel(result.message);
      return result.url;
    });
    try {
      await writeToClipboard(url);
      setState({ kind: 'copied' });
    } catch {
      // A falha do clipboard não diz se o link existe: a promessa da action diz.
      try {
        setState({ kind: 'manual', url: await url });
      } catch (error) {
        setState({
          kind: 'error',
          message: error instanceof LinkIndisponivel ? error.message : FALHA,
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <div>
        <Button type="button" variant="secondary" size="sm" loading={pending} onClick={copy}>
          <Copy aria-hidden="true" className="size-3.5" />
          {label}
        </Button>
      </div>
      {state.kind === 'copied' ? (
        <p role="status" className="text-(length:--fs-xs) font-medium text-success-700">
          Link copiado. Cole na conversa com o paciente.
        </p>
      ) : null}
      {state.kind === 'manual' ? (
        <div className="grid gap-1">
          <p role="status" className="text-(length:--fs-xs)">
            Não foi possível copiar automaticamente. Copie o link abaixo.
          </p>
          <Input
            readOnly
            value={state.url}
            aria-label="Link de pagamento"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" className="text-(length:--fs-xs) font-medium text-danger-700">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
