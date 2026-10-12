/**
 * Contratos públicos do context Payments (ADR-049, Modelo B).
 *
 * Regra que atravessa este arquivo inteiro: **nenhum tipo daqui carrega a chave
 * da clínica**. Entrada é a única fronteira onde o segredo aparece, e ele morre
 * na Server Action (validado → cifrado → gravado). Nada que sai para o cliente,
 * para o audit ou para métrica contém a chave.
 */
import { z } from 'zod';

/**
 * Chave da API Asaas da clínica.
 *
 * O que NÃO se valida aqui de propósito: **formato/prefixo**. Hoje as chaves do
 * Asaas começam com `$aact_`, mas prender o sistema a esse detalhe significa
 * quebrar no dia em que o Asaas emitir um formato novo — e o operador ficaria
 * travado sem entender por quê. A validação de verdade é a chamada `GET /myAccount`
 * na Server Action: ou a chave abre a conta, ou não abre.
 *
 * O que se valida: não-vazia, sem espaço no meio (colagem quebrada por quebra de
 * linha é o erro de digitação mais comum) e com teto de tamanho — o teto é sanidade
 * contra alguém colar um arquivo inteiro no campo, não uma regra de formato.
 */
export const ConnectPaymentAccountSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, 'Informe a chave de API do Asaas.')
    .max(1024, 'Isso não parece uma chave de API.')
    .refine((v) => !/\s/.test(v), 'A chave não pode conter espaços ou quebras de linha.'),
});

export type ConnectPaymentAccountInput = z.infer<typeof ConnectPaymentAccountSchema>;

/**
 * Estado da conta para a tela. `hasApiKey` é o indicador write-only do ADR-049: diz
 * que EXISTE chave guardada, sem nunca devolvê-la.
 *
 * Detalhe que faz isso funcionar sem tocar a coluna do segredo: a migration 0081
 * tem o CHECK `active = false OR api_key_encrypted IS NOT NULL`. Então `active`
 * — que `authenticated` PODE ler — é prova suficiente de que há chave. O indicador
 * é derivado de uma invariante do banco, não de uma leitura do segredo.
 */
export interface PaymentAccountStatusDTO {
  provider: 'asaas';
  hasApiKey: boolean;
  /** false = cobrança nova bloqueada; chave retida só para reconciliação. */
  acceptNewCharges: boolean;
  /**
   * ADR-049 1.4 — o Asaas confirmou o registro do webhook desta clínica.
   * **`false` com conta conectada é o estado que a tela precisa gritar:** as
   * cobranças serão criadas e NUNCA conciliadas, e todo hold vai vencer.
   */
  webhookConfigured: boolean;
  accountName: string | null;
  keyVersion: number;
  /** ISO string ou null. */
  connectedAt: string | null;
  /**
   * Cobranças com link de pagamento ainda pagável. Continuam pagáveis depois
   * da pausa e são conciliadas normalmente (decisão de 07/10/2026).
   */
  openLinks: number;
  /** Encerramento definitivo — só para conta pausada; null nos demais estados. */
  closure: PaymentAccountClosureDTO | null;
}

/** Encerramento da conta pausada (0115). Datas em ISO. */
export interface PaymentAccountClosureDTO {
  /** O que impede encerrar agora. Tudo zero = pode encerrar. */
  blockers: { openLinks: number; pendingRefunds: number; openDisputes: number };
  canClose: boolean;
  /** Última movimentação considerada: conta, cobranças ou webhook. */
  lastActivityAt: string;
  /** Previsão do encerramento automático se nada mudar. */
  autoCloseAt: string;
  /** Quando saiu o aviso por e-mail; null antes dele. */
  noticeSentAt: string | null;
}

/**
 * Falha segura e acionável do passo 2 da conexão: registrar o webhook.
 *
 * A chave nunca aparece aqui. `message` só pode ser construída pelo servidor a
 * partir de códigos/HTTP já sanitizados pelo adapter do Asaas.
 */
export interface PaymentWebhookConfigurationIssue {
  code:
    | 'qoro_missing_app_base_url'
    | 'qoro_invalid_app_base_url'
    | 'asaas_missing_account_email'
    | 'qoro_payment_account_unavailable'
    | 'qoro_missing_preview_bypass'
    | 'asaas_webhook_rejected'
    | 'asaas_webhook_unavailable'
    | 'qoro_webhook_unexpected';
  location: string;
  message: string;
}

/** Resultado específico da conexão: conta salva + desfecho do webhook. */
export interface ConnectPaymentAccountResult extends PaymentAccountStatusDTO {
  webhookConfigurationIssue: PaymentWebhookConfigurationIssue | null;
}

export const EMPTY_PAYMENT_ACCOUNT: PaymentAccountStatusDTO = {
  provider: 'asaas',
  hasApiKey: false,
  acceptNewCharges: false,
  webhookConfigured: false,
  accountName: null,
  keyVersion: 0,
  connectedAt: null,
  openLinks: 0,
  closure: null,
};

// --- política de sinal (1.2) -------------------------------------------------

/**
 * Entrada do formulário de política. Os mesmos limites existem como CHECK na
 * migration 0082 — de propósito: o Zod dá mensagem boa ao operador, o CHECK
 * garante a invariante mesmo para quem escrever no banco por fora.
 */
export const SaveDepositPolicySchema = z
  .object({
    enabled: z.boolean(),
    percent: z
      .number()
      .int()
      .min(1, 'O sinal precisa ser ao menos 1%.')
      .max(100, 'O sinal não pode passar de 100%.'),
    cancellationWindowHours: z
      .number()
      .int()
      .min(0, 'A antecedência não pode ser negativa.')
      .max(720, 'Antecedência máxima: 720 horas (30 dias).'),
    appliesToFirstVisit: z.boolean(),
    appliesToReturn: z.boolean(),
  })
  .refine((v) => !v.enabled || v.appliesToFirstVisit || v.appliesToReturn, {
    message: 'Com o sinal ligado, escolha ao menos um caso: primeira consulta ou retorno.',
    path: ['appliesToFirstVisit'],
  });

export type SaveDepositPolicyInput = z.infer<typeof SaveDepositPolicySchema>;

/** O que a tela mostra. `updatedAt` é null enquanto a clínica nunca configurou. */
export interface DepositPolicyDTO {
  enabled: boolean;
  percent: number;
  cancellationWindowHours: number;
  appliesToFirstVisit: boolean;
  appliesToReturn: boolean;
  updatedAt: string | null;
}
