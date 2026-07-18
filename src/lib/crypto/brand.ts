/**
 * Branded type para colunas cifradas (auditoria de banco, A1).
 *
 * ⚠️ ZERO imports, ZERO runtime, e SEM `import 'server-only'`. Este módulo é lido
 * transitivamente pelos `schema.ts` dos contextos, que o **drizzle-kit** carrega
 * no `db:generate`/`db:migrate` — um `server-only` aqui quebraria o generate.
 * É type-only: some por completo na compilação.
 *
 * POR QUE existe: a cifra devolve/aceita `string` base64. Sem uma marca no tipo,
 * `text('content_encrypted')` é indistinguível de qualquer outra string, e um
 * call-site que ESQUEÇA de decifrar compila silenciosamente — que é o bug mais
 * perigoso do PR3 (ex.: `isContentEmpty(row.content)` receberia base64, nunca
 * seria "vazio", e a regra "não assinar prontuário vazio" morreria em silêncio).
 *
 * `Encrypted<T>` é uma string que só pode ser produzida por `encryptJson` e só
 * pode ser consumida por `decryptJson` (ambos em clinical/internal/content-crypto).
 * O parâmetro fantasma `T` carrega o tipo do PLAINTEXT para a marca não colar
 * dois domínios diferentes (um `Encrypted<ProntuarioContent>` não satisfaz um
 * `Encrypted<Medicamento[]>`). Um arch-test (grep) pegaria só o que o autor
 * previu; o compilador pega todos os caminhos.
 */
export type Encrypted<T> = string & { readonly __encrypted: (t: T) => void };
