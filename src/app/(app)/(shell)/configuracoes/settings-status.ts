import type { VariantProps } from 'class-variance-authority';

import type { badgeVariants } from '@/components/ui/badge';

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Status de um card — tom do DS + rótulo curto. */
export interface SettingsStatus {
  tone: Tone;
  label: string;
}

/**
 * Espelha `clinic_whatsapp_numbers.connection_status` + `active`.
 *
 * Leitura DELIBERADAMENTE mais grossa que a da tela de detalhe: o card responde
 * "preciso olhar isso?" em uma palavra, enquanto `/configuracoes/whatsapp`
 * distingue verificação pendente de canal mudo. Nada aqui inventa estado.
 */
export function channelStatus(input: { connected: boolean; degraded: boolean }): SettingsStatus {
  if (input.connected) return { tone: 'green', label: 'Conectado' };
  // META-001: número ativo cujo canal não entrega. A tela de detalhe chama a
  // Meta para saber POR QUÊ; o card só reporta que existe algo quebrado — e não
  // finge saúde que não verificou.
  if (input.degraded) return { tone: 'red', label: 'Não está recebendo' };
  return { tone: 'gray', label: 'Não conectado' };
}
