'use client';

import { Copy, MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderIcon,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';

import { cancelInviteAction, resendInviteAction } from './actions';

/**
 * Ações de linha para convites PENDENTES (spec convite §Fase 2a). Renderizado só
 * quando `pending` pela Equipe.
 *
 * - Reenviar: envia um e-mail novo e também copia o link recovery para o clipboard.
 *   Sem clipboard → Dialog com o link à mão.
 * - Cancelar: hard delete do convite (libera vaga + e-mail) via ConfirmDialog.
 */
export function InviteRowActions({ userId, nome }: { userId: string; nome: string }) {
  const router = useRouter();
  const [resending, startResend] = useTransition();
  const [cancelling, startCancel] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const linkRef = useRef<HTMLTextAreaElement>(null);

  function handleResend() {
    startResend(async () => {
      const res = await resendInviteAction({ userId });
      if ('error' in res) {
        toast.error('Não foi possível reenviar', res.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(res.link);
        toast.success(
          'Convite reenviado',
          `O e-mail foi enviado para ${nome} e o link também foi copiado.`,
        );
      } catch {
        // Sem clipboard (permissão / contexto inseguro) → mostra o link para copiar à mão.
        setLink(res.link);
        setLinkOpen(true);
      }
    });
  }

  function handleCancel() {
    startCancel(async () => {
      const res = await cancelInviteAction({ userId });
      if ('ok' in res) {
        toast.success('Convite cancelado', `${nome} foi removido e a vaga foi liberada.`);
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error('Não foi possível cancelar', res.error);
      }
    });
  }

  async function copyFromDialog() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      linkRef.current?.select();
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" icon aria-label={`Ações do convite de ${nome}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={resending} onSelect={handleResend}>
            Reenviar convite
          </DropdownMenuItem>
          <DropdownMenuItem danger onSelect={() => setConfirmOpen(true)}>
            Cancelar convite
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title="Cancelar convite"
        description={`${nome} perde o acesso e a vaga é liberada.`}
        confirmLabel="Cancelar convite"
        cancelLabel="Voltar"
        loading={cancelling}
        action={handleCancel}
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogHeaderIcon>
              <Copy />
            </DialogHeaderIcon>
            <div className="min-w-0">
              <DialogTitle>Copiar link do convite</DialogTitle>
              <DialogDescription>
                Não foi possível copiar automaticamente. Copie o link e envie para {nome}.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody>
            <textarea
              ref={linkRef}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-24 w-full resize-none rounded-(--r-md) border border-border bg-surface-2 p-2.5 text-(length:--fs-sm) break-all"
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Fechar</Button>
            </DialogClose>
            <Button onClick={copyFromDialog}>
              <Copy className="size-3.5" />
              Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
