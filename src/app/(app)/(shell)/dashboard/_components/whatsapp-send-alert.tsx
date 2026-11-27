import { MessageCircleWarning } from 'lucide-react';

import { PendingItem } from './pending-item';

/**
 * A única faixa do painel sobre mensagens automáticas do WhatsApp que não estão
 * chegando ao paciente. Junta as duas causas para não haver dois avisos
 * concorrentes:
 *  - a CONTA (0116): a Meta bloqueia ou limita todos os envios iniciados pela
 *    clínica — lembrete, link do sinal, cobrança, oferta de vaga;
 *  - as mensagens que NÃO CHEGARAM, uma a uma (jobs da C14 em `failed`), que a
 *    sessão "Mostrar à clínica a recusa de mensagem proativa" preenche. A conta
 *    inclui falhas que não são recusa da Meta (número desconectado, template
 *    não configurado, resultado desconhecido), por isso o texto não diz
 *    "recusadas pela Meta".
 * A pendência da conta vem primeiro porque ela explica as falhas, e leva à tela
 * de WhatsApp, onde se resolve. Sem pendência da conta, a faixa leva à Agenda,
 * onde está cada paciente que ficou sem a mensagem e a ação para ele.
 */
export interface WhatsappSendAlertData {
  account: { state: 'blocked' | 'limited'; headline: string } | null;
  /** `since`: rótulo pronto do período, ex.: "nas últimas 24 h". */
  refusals: { count: number; since: string } | null;
}

type Refusals = NonNullable<WhatsappSendAlertData['refusals']>;

function withSince(what: string, since: string): string {
  return since ? `${what} ${since}` : what;
}

function refusalsLabel({ count, since }: Refusals): string {
  return withSince(
    count === 1
      ? '1 mensagem automática não chegou ao paciente'
      : `${count} mensagens automáticas não chegaram aos pacientes`,
    since,
  );
}

/** Depois do aviso da conta, que já diz que não chegam: só a contagem. */
function refusalsSuffix({ count, since }: Refusals): string {
  return withSince(count === 1 ? '1 não chegou' : `${count} não chegaram`, since);
}

export function WhatsappSendAlert({ account, refusals }: WhatsappSendAlertData) {
  const refused = refusals && refusals.count > 0 ? refusals : null;
  if (!account && !refused) return null;

  const text = account
    ? refused
      ? `${account.headline} · ${refusalsSuffix(refused)}`
      : account.headline
    : refusalsLabel(refused!);
  // Vermelho quando a Meta bloqueia os envios, âmbar quando limita ou quando
  // só algumas mensagens não chegaram. O texto diz qual é; a cor só reforça.
  return (
    <PendingItem
      href={account ? '/configuracoes/whatsapp' : '/agenda'}
      tone={account?.state === 'blocked' ? 'danger' : 'warning'}
      icon={<MessageCircleWarning />}
      title={text}
      cta={account ? 'Ver o que fazer' : 'Ver na Agenda'}
      data-whatsapp-send-alert={account?.state ?? 'refusals'}
    />
  );
}
