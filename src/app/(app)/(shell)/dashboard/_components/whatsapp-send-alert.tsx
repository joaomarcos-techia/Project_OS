import { ChevronRight, MessageCircleWarning } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/ui/cn';

import styles from '../dashboard.module.css';

/**
 * A única faixa do painel sobre mensagens automáticas do WhatsApp que não estão
 * chegando ao paciente. Junta as duas causas para não haver dois avisos
 * concorrentes:
 *  - a CONTA (0116): a Meta bloqueia ou limita todos os envios iniciados pela
 *    clínica — lembrete, link do sinal, cobrança, oferta de vaga;
 *  - as RECUSAS por mensagem (jobs da C14 recusados pela Meta), que a sessão
 *    "Mostrar à clínica a recusa de mensagem proativa" preenche.
 * A pendência da conta vem primeiro porque ela explica as recusas.
 */
export interface WhatsappSendAlertData {
  account: { state: 'blocked' | 'limited'; headline: string } | null;
  /** `since`: rótulo pronto do período, ex.: "nas últimas 24 h". */
  refusals: { count: number; since: string } | null;
}

function refusalsLabel(refusals: { count: number; since: string }): string {
  const what =
    refusals.count === 1
      ? '1 mensagem automática recusada pela Meta'
      : `${refusals.count} mensagens automáticas recusadas pela Meta`;
  return refusals.since ? `${what} ${refusals.since}` : what;
}

export function WhatsappSendAlert({ account, refusals }: WhatsappSendAlertData) {
  const refused = refusals && refusals.count > 0 ? refusals : null;
  if (!account && !refused) return null;

  const text = account
    ? refused
      ? `${account.headline} · ${refusalsLabel(refused)}`
      : account.headline
    : refusalsLabel(refused!);
  return (
    <Link
      href="/configuracoes/whatsapp"
      className={cn(
        styles.alert,
        account?.state === 'blocked' ? styles.alertDanger : styles.alertWarning,
      )}
      data-whatsapp-send-alert={account?.state ?? 'refusals'}
    >
      <MessageCircleWarning aria-hidden="true" />
      <span className={styles.alertText ?? ''}>{text}</span>
      <span className={styles.alertCta ?? ''}>Ver o que fazer</span>
      <ChevronRight aria-hidden="true" />
    </Link>
  );
}
