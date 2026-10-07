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

import { connectPaymentAccountAction, disconnectPaymentAccountAction } from './actions';

interface Props {
  status: PaymentAccountStatusDTO;
}

export function PaymentAccountPanel({ status }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [webhookIssue, setWebhookIssue] = useState<PaymentWebhookConfigurationIssue | null>(null);
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
              A conta continua conectada somente para conciliar cobranças e estornos já existentes.
              Para voltar a cobrar, reenvie a chave da conta Asaas.
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
              {status.hasApiKey ? (
                <Button type="button" variant="ghost" disabled={pending} onClick={handleDisconnect}>
                  {status.acceptNewCharges ? 'Pausar ou desconectar' : 'Tentar desconexão'}
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
