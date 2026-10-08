import { describe, expect, it } from 'vitest';

import { AUDIO_REPLY, FILE_REPLY } from '../prompts/system';
import { inboundMedia } from './inbound-media';

describe('inboundMedia (W18 — mensagem sem texto)', () => {
  it('áudio pede a mensagem escrita, sem ir para a equipe', () => {
    expect(inboundMedia('audio')).toEqual({ kind: 'audio', turnText: '[Áudio]', reply: AUDIO_REPLY });
  });

  it('imagem, documento e vídeo vão para a equipe', () => {
    expect(inboundMedia('image')).toEqual({ kind: 'file', turnText: '[Imagem]', reply: FILE_REPLY });
    expect(inboundMedia('document')?.turnText).toBe('[Documento]');
    expect(inboundMedia('video')?.turnText).toBe('[Vídeo]');
  });

  it('figurinha, reação, localização e tipo desconhecido seguem sem resposta', () => {
    for (const type of ['sticker', 'reaction', 'location', 'contacts', 'unsupported', 'text']) {
      expect(inboundMedia(type)).toBeNull();
    }
    expect(inboundMedia(undefined)).toBeNull();
    expect(inboundMedia(null)).toBeNull();
  });

  it('nome de propriedade herdada não vira mídia', () => {
    expect(inboundMedia('constructor')).toBeNull();
    expect(inboundMedia('__proto__')).toBeNull();
  });

  it('as respostas são as aprovadas pelo usuário em 08/10/2026', () => {
    expect(AUDIO_REPLY).toBe('Ainda não consigo ouvir áudios por aqui. Pode me escrever?');
    expect(FILE_REPLY).toBe('Recebi seu arquivo, vou passar para a equipe.');
  });
});
