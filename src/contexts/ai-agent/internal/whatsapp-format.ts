/**
 * Formatação do WhatsApp na resposta do agente (08/10/2026, EC-24).
 *
 * O modelo escreve Markdown: `**negrito**`, `# título`, `[texto](link)`. No
 * WhatsApp o negrito é `*negrito*` e o resto aparece cru — ao vivo, o paciente
 * via os asteriscos dobrados. O prompt pede a formatação certa, mas quem
 * garante é esta conversão, no servidor, antes de gravar e enviar: o prompt
 * sozinho falha de vez em quando.
 *
 * Idempotente: texto já no formato do WhatsApp passa intacto, e as respostas
 * fixas do servidor (que não têm Markdown) também. URLs ficam de fora — um `__`
 * ou `**` dentro de um link não é formatação.
 */

const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const URL_RE = /https?:\/\/[^\s]+/g;

function convertProse(segment: string): string {
  return (
    segment
      // `**negrito**` e `__negrito__` → `*negrito*`.
      .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '*$1*')
      .replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, '*$1*')
      // Título Markdown vira uma linha em negrito.
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '*$1*')
      // Item de lista com `*` ou `•` vira `- `: no começo da linha, um `*`
      // seguido de espaço disputa com o negrito.
      .replace(/^([ \t]*)[*•][ \t]+/gm, '$1- ')
      // Separador horizontal não existe no WhatsApp.
      .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$\n?/gm, '')
      // Sobra de `**` sem par: melhor sumir do que aparecer para o paciente.
      .replace(/\*\*+/g, '')
  );
}

/** Converte Markdown no formato do WhatsApp, preservando as URLs. */
export function toWhatsAppFormatting(text: string): string {
  const withoutLinks = text.replace(MARKDOWN_LINK_RE, (_match, label: string, url: string) =>
    label.trim() === url ? url : `${label.trim()}: ${url}`,
  );
  let out = '';
  let last = 0;
  for (const match of withoutLinks.matchAll(URL_RE)) {
    out += convertProse(withoutLinks.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  out += convertProse(withoutLinks.slice(last));
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
