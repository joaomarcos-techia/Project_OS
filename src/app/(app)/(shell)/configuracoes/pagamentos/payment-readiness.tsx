import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DepositPolicyDTO, PaymentAccountStatusDTO } from '@/contexts/payments';

export function PaymentReadiness({
  account,
  policy,
}: {
  account: PaymentAccountStatusDTO;
  policy: DepositPolicyDTO;
}) {
  const checks = [
    { label: 'Conta Asaas da clínica conectada', ready: account.hasApiKey },
    { label: 'Conta liberada para novas cobranças', ready: account.acceptNewCharges },
    { label: 'Webhook de pagamentos configurado', ready: account.webhookConfigured },
    { label: 'Política de sinal habilitada', ready: policy.enabled },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>O que falta para cobrar automaticamente?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-(length:--fs-sm)">
        <ul className="flex flex-col gap-2" aria-label="Pré-requisitos da cobrança">
          {checks.map((check) => (
            <li key={check.label}>
              <strong>{check.ready ? 'Configurado' : 'Pendente'}</strong> — {check.label}
            </li>
          ))}
        </ul>
        <p>
          Hoje, a política de sinal também habilita a cobrança do saldo após a consulta. Ativá-la
          pode exigir pagamento antecipado nas novas marcações, conforme os critérios escolhidos.
        </p>
        <p>
          O saldo só pode gerar cobrança depois que a equipe concluir o atendimento e existir valor
          a receber em aberto. A passagem do horário da consulta não a conclui automaticamente.
          Registre primeiro os pagamentos recebidos na recepção para evitar cobrar um saldo já
          quitado.
        </p>
        <p>
          O envio pelo WhatsApp também depende da conexão, do consentimento específico do paciente e
          das regras de envio. Cadastrar um paciente não concede automaticamente permissão para
          lembretes ou cobranças. Confira essas autorizações no perfil do paciente.
        </p>
      </CardContent>
    </Card>
  );
}
