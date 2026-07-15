/**
 * Fábrica das chaves de idempotência das Server Actions. Antes clonada
 * byte-a-byte em 4 contextos (patient/clinical/scheduling/financial), variando
 * só o prefixo e a classe/mensagem de erro (S1).
 */

/** Mensagem única quando a idempotencyKey não é um UUID válido. Fonte única
 *  para os 4 contextos — antes o `patient` divergia em inglês. */
export const IDEM_KEY_INVALID_MESSAGE = 'idempotencyKey deve ser um UUID';

/**
 * Cria a função `idemKey(action, clientKey)` de um contexto, que produz uma
 * chave CHECK-valid `${prefix}:${action}:${hex}`.
 *
 * `onInvalid` é um factory de erro do PRÓPRIO contexto: só a CLASSE de erro é
 * injetada (ela vive em `contexts/*` e a fronteira proíbe `lib → contexts`); a
 * MENSAGEM vem de `IDEM_KEY_INVALID_MESSAGE` (única, aqui), passada ao factory.
 * Comportamento observável estável: mesma string de chave (prefixo é parâmetro)
 * e mesmo erro tipado; a mensagem não pode mais divergir por contexto.
 *
 * @param prefix   namespace do contexto (`'patient'`, `'clinical'`, …).
 * @param onInvalid factory do erro (recebe a mensagem) lançado quando a chave
 *                  não é um UUID válido.
 */
export function makeIdemKey(
  prefix: string,
  onInvalid: (message: string) => Error,
): (action: string, clientKey: string) => string {
  return (action, clientKey) => {
    const hex = clientKey.replace(/-/g, '').toLowerCase();
    if (!/^[a-f0-9]{8,}$/.test(hex)) {
      throw onInvalid(IDEM_KEY_INVALID_MESSAGE);
    }
    return `${prefix}:${action}:${hex}`;
  };
}
