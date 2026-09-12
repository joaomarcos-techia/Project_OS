import { maskPhoneBR } from '@/lib/masks';

/**
 * Telefone do contato do WhatsApp, formatado.
 *
 * O número chega em DÍGITOS CRUS: `normalizePhone` (lib/crypto) só remove o que
 * não é dígito, então o que está cifrado é `11988421190` ou `5511988421190`,
 * conforme a origem. Toda a outra tela do produto mostra `(11) 98842-1190`; sem
 * isto, a mesma pessoa aparece com dois telefones diferentes em duas telas.
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
  if (!ehTelefoneBR(nacional)) return cru;
  return comDdi ? `+55 ${maskPhoneBR(nacional)}` : maskPhoneBR(nacional);
}

/**
 * Comprimento não basta para reconhecer um número brasileiro: `+12025550147`
 * (EUA, em E.164) também tem 11 dígitos e sairia como `(12) 02555-0147`.
 *
 * O que discrimina é o PLANO DE NUMERAÇÃO: DDD nunca começa em 0; celular tem 11
 * dígitos e o assinante começa obrigatoriamente em 9; fixo tem 10 e começa entre
 * 2 e 5.
 */
function ehTelefoneBR(d: string): boolean {
  return /^[1-9]\d9\d{8}$/.test(d) || /^[1-9]\d[2-5]\d{7}$/.test(d);
}

/**
 * Como o contato se apresenta na inbox: um título e, quando acrescenta algo, o
 * telefone embaixo.
 *
 * Sem cadastro, o telefone JÁ É o título — repeti-lo na linha de baixo não
 * informa nada, só duplica o único dado que existe sobre a pessoa.
 */
export function identidadeDoContato(contato: {
  patientDisplayName: string | null;
  contactPhone: string | null;
  maskedPhone: string | null;
}): { titulo: string; telefone: string | null } {
  const telefone = contato.contactPhone
    ? telefoneDoContato(contato.contactPhone)
    : contato.maskedPhone;
  const nome = contato.patientDisplayName;
  return {
    titulo: nome ?? telefone ?? 'Contato desconhecido',
    telefone: nome ? telefone : null,
  };
}
