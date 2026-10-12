/**
 * Mensagem sem texto (08/10/2026, W18): áudio, imagem, documento e vídeo.
 *
 * Antes, toda mensagem sem texto era marcada como consumida e o paciente ficava
 * sem resposta nenhuma. O agente continua sem ouvir áudio e sem ler arquivo; o
 * que muda é que ele responde. Áudio recebe o pedido da mensagem escrita.
 * Arquivo (comprovante, guia, exame) vai para a equipe, que vê o conteúdo no app
 * do WhatsApp Business. Figurinha, reação, localização e tipos desconhecidos
 * seguem sem resposta, como antes.
 */
import { AUDIO_REPLY, FILE_REPLY } from '../prompts/system';

export type InboundMediaKind = 'audio' | 'file';

export interface InboundMedia {
  kind: InboundMediaKind;
  /** O que fica na conversa (inbox e histórico do modelo) no lugar do conteúdo. */
  turnText: string;
  /** Resposta fixa do servidor — o LLM não roda neste caminho. */
  reply: string;
}

const FILE_LABELS: ReadonlyMap<string, string> = new Map([
  ['image', '[Imagem]'],
  ['document', '[Documento]'],
  ['video', '[Vídeo]'],
]);

/** `type` da Meta → como o agente trata a mensagem. `null` = segue sem resposta. */
export function inboundMedia(messageType: string | null | undefined): InboundMedia | null {
  if (messageType === 'audio') return { kind: 'audio', turnText: '[Áudio]', reply: AUDIO_REPLY };
  const label = messageType ? FILE_LABELS.get(messageType) : undefined;
  return label ? { kind: 'file', turnText: label, reply: FILE_REPLY } : null;
}
