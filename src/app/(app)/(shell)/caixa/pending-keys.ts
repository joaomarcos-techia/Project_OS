/**
 * P-19 (docs/otimização_ui_final.md, 25.9 e 28): chaves de idempotência das operações do Caixa
 * que ainda não tiveram confirmação do servidor, guardadas NA ABA (`sessionStorage`) para
 * sobreviver a um recarregamento. Sem isso, recarregar a página no meio de um registro sem
 * resposta e repetir o mesmo pedido mandava uma chave nova, e um recebimento parcial podia ser
 * gravado duas vezes.
 *
 * O que é guardado: só um RESUMO do pedido (hash não criptográfico) e a chave UUID, com prazo.
 * Nunca o valor, o lançamento, a forma de pagamento ou o comprovante em claro. Uma colisão de
 * resumo só faria o servidor recusar a repetição (`IdempotencyConflictError`), nunca gravar
 * em dobro. O prazo (30 min) fica muito abaixo da validade da chave no servidor (7 dias,
 * `MUTATION_IDEM_TTL_SECONDS`).
 *
 * Limites: outra aba ou outro aparelho não enxerga a chave; aí vale o saldo mostrado pela tela
 * recarregada ("Registrar o restante"). Fechar o restante exige contrato de servidor (P-19,
 * proposta `valorPagoEsperado`, do domínio financeiro).
 */

export const PENDING_KEY_TTL_MS = 30 * 60 * 1000;
const STORAGE_KEY = 'qoro:caixa:operacoes-sem-confirmacao';

export type PendingKey = { chave: string; ate: number };

/** cyrb53 (domínio público), duas sementes → resumo de 106 bits em hexadecimal. */
function cyrb53(texto: string, semente: number): string {
  let h1 = 0xdeadbeef ^ semente;
  let h2 = 0x41c6ce57 ^ semente;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function resumoDoPedido(pedido: string): string {
  return `${cyrb53(pedido, 1)}${cyrb53(pedido, 2)}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Lê as chaves em aberto da aba, descartando as vencidas. Falha de leitura = mapa vazio. */
export function lerChavesEmAberto(agora = Date.now()): Map<string, PendingKey> {
  const mapa = new Map<string, PendingKey>();
  try {
    const bruto = storage()?.getItem(STORAGE_KEY);
    if (!bruto) return mapa;
    const lido: unknown = JSON.parse(bruto);
    if (!lido || typeof lido !== 'object') return mapa;
    for (const [resumo, valor] of Object.entries(lido as Record<string, unknown>)) {
      const entrada = valor as Partial<PendingKey> | null;
      if (
        entrada &&
        typeof entrada.chave === 'string' &&
        typeof entrada.ate === 'number' &&
        entrada.ate > agora
      ) {
        mapa.set(resumo, { chave: entrada.chave, ate: entrada.ate });
      }
    }
  } catch {
    // Aba privada, armazenamento bloqueado ou conteúdo inválido: segue só em memória.
  }
  return mapa;
}

/** Grava o mapa na aba. Falha de escrita não interrompe o registro: a memória ainda vale. */
export function gravarChavesEmAberto(mapa: Map<string, PendingKey>): void {
  try {
    const alvo = storage();
    if (!alvo) return;
    if (mapa.size === 0) {
      alvo.removeItem(STORAGE_KEY);
      return;
    }
    alvo.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(mapa)));
  } catch {
    // Sem armazenamento: a proteção continua valendo enquanto a página estiver aberta.
  }
}

export const PENDING_KEYS_STORAGE_KEY = STORAGE_KEY;
