import { maskPhoneBR } from '@/lib/masks';

/**
 * Telefone do contato do WhatsApp, formatado.
 *
 * O número chega em DÍGITOS CRUS: `normalizePhone` (lib/crypto) só remove o que
 * não é dígito, então o que está cifrado é `11988421190` ou `5511988421190`,
 * conforme a origem. Sem DDI (o que o cadastro grava), sai como no resto do
 * produto: `(11) 98842-1190`. Com DDI (o que o webhook do WhatsApp grava), sai
 * no formato internacional que a recepção lê no próprio WhatsApp:
 * `+55 11 98842-1190`.
 *
 * `maskPhoneBR` corta em 11 dígitos, então o DDI precisa sair antes — passar
 * `5511988421190` direto devolveria `(55) 11988-4211`, um número que não existe.
 * E quando o formato não é reconhecível como BR, devolvemos o número como veio:
 * exibir dígitos crus é feio, exibir um telefone errado é mentira — a recepção
 * ligaria para ele.
 */
export function telefoneDoContato(cru: string): string {
  const digitos = cru.replace(/\D/g, '');
  const comDdi = digitos.length > 11 && digitos.startsWith('55');
  const nacional = comDdi ? digitos.slice(2) : digitos;
  if (!ehTelefoneBR(nacional, comDdi)) return cru;
  if (!comDdi) return maskPhoneBR(nacional);
  const assinante = nacional.slice(2);
  const corte = assinante.length - 4;
  return `+55 ${nacional.slice(0, 2)} ${assinante.slice(0, corte)}-${assinante.slice(corte)}`;
}

/**
 * Comprimento não basta para reconhecer um número brasileiro: `+12025550147`
 * (EUA, em E.164) também tem 11 dígitos e sairia como `(12) 02555-0147`.
 *
 * O que discrimina é o PLANO DE NUMERAÇÃO: DDD não tem zero; celular tem 11
 * dígitos e o assinante começa obrigatoriamente em 9; fixo tem 10 e começa entre
 * 2 e 5. O WhatsApp ainda identifica muitos celulares pelo número de ANTES do
 * nono dígito (`55` + DDD + 8 dígitos, começando entre 6 e 9). Esse formato só
 * vale com o DDI: é o `wa_id` da Meta, nunca algo que o cadastro grave.
 */
function ehTelefoneBR(d: string, comDdi: boolean): boolean {
  if (/^[1-9]{2}9\d{8}$/.test(d) || /^[1-9]{2}[2-5]\d{7}$/.test(d)) return true;
  return comDdi && /^[1-9]{2}[6-9]\d{7}$/.test(d);
}

/**
 * Como o contato se apresenta na inbox: um título e, quando acrescenta algo, o
 * telefone embaixo.
 *
 * O nome do cadastro vem primeiro; sem cadastro, vale o nome que o contato usa
 * no perfil do WhatsApp. Sem nenhum dos dois, o telefone JÁ É o título — repeti-lo
 * na linha de baixo não informa nada, só duplica o único dado que existe.
 */
export function identidadeDoContato(contato: {
  patientDisplayName: string | null;
  contactName?: string | null;
  contactPhone: string | null;
  maskedPhone: string | null;
}): { titulo: string; telefone: string | null } {
  const telefone = contato.contactPhone
    ? telefoneDoContato(contato.contactPhone)
    : contato.maskedPhone;
  const nome = contato.patientDisplayName ?? contato.contactName ?? null;
  return {
    titulo: nome ?? telefone ?? 'Contato desconhecido',
    telefone: nome ? telefone : null,
  };
}
