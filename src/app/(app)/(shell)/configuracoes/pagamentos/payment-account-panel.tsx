'use client';

/**
 * Painel da conta Asaas da clínica.
 *
 * Cuidados com o segredo NO CLIENTE (o servidor já tem os dele):
 *   - o campo é `type="password"` — chave de API é ombro-espiável e vaza em
 *     screenshot de suporte, que é como esse tipo de credencial costuma vazar
 *     de verdade;
 *   - `autoComplete="off"` e `spellCheck={false}`: gerenciador de senha e
 *     corretor não devem tocar numa chave de terceiro;
 *   - o valor é limpo do estado assim que a ação retorna — sucesso OU falha. O
 *     campo não guarda a chave "para tentar de novo";
 *   - nada é ecoado de volta: o servidor só devolve `hasApiKey`, nunca a chave.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, KeyRound } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import type {
  PaymentAccountStatusDTO,
  PaymentWebhookConfigurationIssue,
} from '@/contexts/payments';
import { formatDatePt } from '@/lib/format';

import {
  closePaymentAccountAction,
  connectPaymentAccountAction,
  disconnectPaymentAccountAction,
} from './actions';

interface Props {
  status: PaymentAccountStatusDTO;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function openLinksText(count: number): string {
  return plural(count, 'link de pagamento aberto', 'links de pagamento abertos');
}

export function PaymentAccountPanel({ status }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [webhookIssue, setWebhookIssue] = useState<PaymentWebhookConfigurationIssue | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = apiKey;
    setError(null);
    setNotice(null);
    setWebhookIssue(null);
    startTransition(async () => {
      const result = await connectPaymentAccountAction(value);
      // Limpa SEMPRE, inclusive no erro: a chave não fica pendurada no estado do
      // componente enquanto o operador lê a mensagem.
      setApiKey('');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setWebhookIssue(result.data.webhookConfigurationIssue);
      if (result.data.webhookConfigurationIssue) {
        router.refresh();
        return;
      }
      setNotice(
        result.data.accountName
          ? `Conta conectada: ${result.data.accountName}.`
          : 'Conta conectada.',
      );
      router.refresh();
    });
  }

  function handleDisconnect() {
    setError(null);
    setNotice(null);
    setWebhookIssue(null);
    startTransition(async () => {
      const result = await disconnectPaymentAccountAction();
      if (!result.ok) {
        setError(result.message);
        router.refresh();
        return;
      }
      setNotice(
        result.data.hasApiKey
          ? 'Novas cobranças foram pausadas. A chave e o webhook ficam ativos para conciliar pagamentos e estornos existentes.'
          : 'Conta desconectada. Não há webhook ativo para esta conta no Asaas, e a chave foi apagada do sistema.',
      );
      router.refresh();
    });
  }

  function handleClose() {
    setError(null);
    setNotice(null);
    setWebhookIssue(null);
    startTransition(async () => {
      const result = await closePaymentAccountAction();
      setConfirmClose(false);
      if (!result.ok) {
        setError(result.message);
        router.refresh();
        return;
      }
      setNotice(
        'Conta encerrada. O webhook foi desativado no Asaas e a chave foi apagada do sistema.',
      );
      router.refresh();
    });
  }

  const closure = status.closure;
  const closureBlockers = closure
    ? [
        closure.blockers.openLinks ? openLinksText(closure.blockers.openLinks) : null,
        closure.blockers.pendingRefunds
          ? plural(
              closure.blockers.pendingRefunds,
              'devolução sem confirmação',
              'devoluções sem confirmação',
            )
          : null,
        closure.blockers.openDisputes
          ? plural(
              closure.blockers.openDisputes,
              'contestação em andamento',
              'contestações em andamento',
            )
          : null,
      ].filter((item): item is string => item !== null)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pagamentos"
        description="Conecte a conta Asaas da clínica. O dinheiro do paciente cai direto nela — o Qoro não fica com o valor em nenhum momento."
      />

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="size-5" />
            Conta Asaas
          </CardTitle>
          <CardDescription>
            A chave é guardada cifrada e nunca é exibida de volta — nem para você, nem para o
            suporte. Para trocá-la, basta enviar a nova.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {webhookIssue || (status.hasApiKey && !status.webhookConfigured) ? (
            <Alert variant="warning" title="Webhook de pagamento não configurado">
              <div className="flex flex-col gap-2 text-pretty">
                <p>
                  A chave foi aceita e a conta foi salva, mas falhou a etapa que registra o aviso
                  automático de pagamento. Sem esse webhook, o sistema não confirma o sinal pago.
                </p>
                {webhookIssue ? (
                  <>
                    <p>
                      <b>Onde ocorreu:</b> {webhookIssue.location}.
                    </p>
                    <p>
                      <b>Motivo:</b> {webhookIssue.message}
                    </p>
                    <p>
                      <b>Código para suporte:</b> <code>{webhookIssue.code}</code>
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <b>Onde ocorreu:</b> entre o Qoro e o Asaas, na operação{' '}
                      <code>POST /webhooks</code>. A confirmação do Asaas não foi registrada.
                    </p>
                    <p>
                      Reenvie a chave para repetir somente essa configuração. A nova tentativa
                      mostrará o local, o motivo e um código técnico seguro.
                    </p>
                  </>
                )}
              </div>
            </Alert>
          ) : null}

          {status.hasApiKey && !status.acceptNewCharges ? (
            <Alert variant="warning" title="Novas cobranças pausadas">
              <div className="flex flex-col gap-2 text-pretty">
                <p>
                  A conta continua conectada somente para conciliar cobranças e estornos já
                  existentes. Para voltar a cobrar, reenvie a chave da conta Asaas.
                </p>
                {status.openLinks > 0 ? (
                  <p>
                    {openLinksText(status.openLinks)} antes da pausa ainda{' '}
                    {status.openLinks === 1 ? 'pode' : 'podem'} ser{' '}
                    {status.openLinks === 1 ? 'pago' : 'pagos'}. O Qoro concilia esses pagamentos
                    normalmente.
                  </p>
                ) : null}
              </div>
            </Alert>
          ) : null}

          {status.hasApiKey ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={status.acceptNewCharges ? 'green' : 'amber'}>
                {status.acceptNewCharges ? (
                  <CircleCheck aria-hidden="true" className="size-4" />
                ) : null}
                {status.acceptNewCharges ? 'Conectada' : 'Pausada'}
              </Badge>
              {status.accountName ? (
                <span className="text-(length:--fs-sm)">{status.accountName}</span>
              ) : null}
              {status.connectedAt ? (
                <span className="text-(length:--fs-sm) text-fg-muted">
                  desde {formatDatePt(status.connectedAt)}
                </span>
              ) : null}
            </div>
          ) : (
            <Alert variant="info">
              Nenhuma conta conectada. Enquanto isso, a clínica não consegue cobrar o paciente pelo
              sistema.
            </Alert>
          )}

          <form className="flex flex-col gap-4" onSubmit={handleConnect}>
            <Field
              label={status.hasApiKey ? 'Trocar a chave de API' : 'Chave de API do Asaas'}
              htmlFor="asaas-api-key"
              hint="Encontre em Asaas → Configurações → Integrações → Chave de API."
            >
              <Input
                id="asaas-api-key"
                name="asaas-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={pending}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Cole aqui a chave da conta da clínica"
              />
            </Field>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending || apiKey.trim().length === 0}>
                {status.hasApiKey ? 'Conectar ou retomar' : 'Conectar conta'}
              </Button>
              {status.hasApiKey && status.acceptNewCharges ? (
                <Button type="button" variant="ghost" disabled={pending} onClick={handleDisconnect}>
                  Pausar ou desconectar
                </Button>
              ) : null}
            </div>
            {status.acceptNewCharges && status.openLinks > 0 ? (
              <p className="text-pretty text-(length:--fs-sm) text-fg-muted">
                Há {openLinksText(status.openLinks)}. Se você pausar, eles continuam pagáveis e o
                Qoro concilia o pagamento.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {closure ? (
        <Card>
          <CardHeader>
            <CardTitle>Encerrar definitivamente</CardTitle>
            <CardDescription>
              Desativa o webhook no Asaas e apaga a chave do sistema. Depois disso, pagamentos,
              estornos e contestações desta conta não são mais conciliados pelo Qoro.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-pretty text-(length:--fs-sm)">
            {closure.canClose ? (
              confirmClose ? (
                <div className="flex flex-col gap-3 rounded-(--r-md) border border-border p-3">
                  <p className="font-medium text-fg">
                    Encerrar a conta Asaas da clínica? Esta ação não pode ser desfeita; para voltar
                    a cobrar, será preciso conectar a conta de novo.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" variant="danger" loading={pending} onClick={handleClose}>
                      Confirmar encerramento
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setConfirmClose(false)}
                    >
                      Voltar
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setConfirmClose(true)}
                  >
                    Encerrar definitivamente
                  </Button>
                </div>
              )
            ) : (
              <p>Para encerrar, resolva antes: {closureBlockers.join(', ')}.</p>
            )}
            <p className="text-fg-muted">
              Sem movimentação e sem pendências, a conta será encerrada automaticamente em{' '}
              {formatDatePt(closure.autoCloseAt)}. O dono da clínica recebe um aviso por e-mail 30
              dias antes.
              {closure.noticeSentAt
                ? ` Aviso enviado em ${formatDatePt(closure.noticeSentAt)}.`
                : ''}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
