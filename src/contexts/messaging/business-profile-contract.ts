/**
 * Contrato do perfil público do WhatsApp da clínica (§33).
 *
 * Módulo PURO de propósito: sem `server-only`, sem acesso a banco, sem Graph.
 * A tela é client component e precisa dos mesmos limites que o servidor aplica
 * — se os `maxLength` do formulário e o Zod da action saíssem de lugares
 * diferentes, um dos dois envelheceria e o usuário descobriria o limite real
 * levando 400 da Meta depois de escrever 500 caracteres.
 *
 * TUDO o que este contrato aceita é PÚBLICO: aparece para qualquer pessoa que
 * abra a conversa com o número da clínica. Não é "visível para quem tem o
 * link". Ver `PERFIL_AVISO_PUBLICO`.
 */
import { z } from 'zod';

/**
 * Limites por campo, em caracteres.
 *
 * Reconferidos contra a documentação da Meta em 20/09/2026, como a §33.2 manda
 * (eles mudam sem aviso). `about` é o único que a referência pública do
 * endpoint não repete por extenso — 139 é o limite histórico do campo "recado"
 * do WhatsApp e é o que a spec registrou.
 *
 * A validação local existe para devolver mensagem por campo em vez de um erro
 * opaco do Graph. Ela NÃO substitui o tratamento do 400: se a Meta apertar um
 * limite, quem manda é a Meta, e o caminho de `profile_write` recusado continua
 * tendo de funcionar.
 */
export const PERFIL_LIMITES = {
  about: 139,
  description: 512,
  address: 256,
  email: 128,
  website: 256,
  /** A Meta aceita no máximo dois sites no perfil. */
  websites: 2,
} as const;

/**
 * A Server Action compartilha o teto de 4,25 MB do upload de logo. Reservar a
 * margem do envelope multipart mantém o arquivo abaixo do limite da Function.
 * A API da Meta aceita JPEG e PNG para a foto do perfil.
 */
export const PERFIL_FOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PERFIL_FOTO_MAX_LABEL = '4 MB';
export const PERFIL_FOTO_MIN_PX = 192;
export const PERFIL_FOTO_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;
export type PerfilFotoMime = keyof typeof PERFIL_FOTO_MIME;

export function isPerfilFotoMime(value: string): value is PerfilFotoMime {
  return Object.prototype.hasOwnProperty.call(PERFIL_FOTO_MIME, value);
}

/**
 * `vertical` — enum fechado da Meta. A lista inteira entra porque a clínica
 * pode já ter escolhido outra categoria no Business Manager, e oferecer só
 * `HEALTH` faria o formulário sobrescrever em silêncio uma escolha existente ao
 * salvar qualquer outro campo.
 */
export const PERFIL_VERTICALS = [
  'UNDEFINED',
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
  'NOT_A_BIZ',
] as const;

export type PerfilVertical = (typeof PERFIL_VERTICALS)[number];

/** Categoria recomendada para clínica — sugestão da UI, não imposição do schema. */
export const PERFIL_VERTICAL_RECOMENDADA: PerfilVertical = 'HEALTH';

/**
 * O aviso que precede os campos na tela. Vive aqui, e não no JSX, porque é
 * controle de segurança declarado na §33.3 nº 2 — e controle que mora só no
 * markup some na primeira refatoração de layout sem ninguém perceber.
 */
export const PERFIL_AVISO_PUBLICO =
  'Tudo nesta seção é público: aparece para qualquer pessoa que abrir a conversa com o número da clínica. Não escreva nome de paciente, dado clínico nem número de prontuário.';

/**
 * Caracteres de controle C0 e DEL, exceto tabulação e quebra de linha.
 *
 * Varredura de code point em vez de classe de regex, de propósito: uma classe
 * de caracteres montada à mão com escapes sobrevive mal à ferramenta de edição
 * — e um caractere de controle CRU no fonte deixa de ser visível em revisão de
 * código. Aqui o critério fica legível e testável.
 */
function temCaractereDeControle(v: string): boolean {
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0;
    // Tabulação e quebra de linha são legítimas: descrição e endereço têm linha.
    if (c === 9 || c === 10) continue;
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/**
 * Remove CR. Textarea no Windows manda CRLF; só o LF interessa, e deixar o CR
 * passar faria o diff acusar alteração em texto que ninguém tocou — bastaria a
 * pessoa abrir o formulario noutro sistema operacional.
 */
function semCr(v: string): string {
  return [...v].filter((ch) => ch.codePointAt(0) !== 13).join('');
}

/**
 * Texto livre: normaliza, `trim`, e vazio significa APAGAR o campo na Meta (é
 * assim que o endpoint se comporta). `undefined` não existe neste contrato — o
 * formulário manda os seis campos sempre, para que "não mexi nisso" e "quero
 * limpar" não fiquem representados pelo mesmo valor.
 */
function textoLivre(limite: number, campo: string) {
  return (
    z
      .string()
      .transform((v) => semCr(v).trim())
      .refine((v) => v.length <= limite, {
        message: `${campo}: máximo de ${limite} caracteres.`,
      })
      // Caractere de controle em campo público é ou colagem acidental de algo
      // formatado, ou tentativa de quebrar o render de quem consome o perfil.
      .refine((v) => !temCaractereDeControle(v), {
        message: `${campo}: contém caractere de controle.`,
      })
  );
}

const EmailContato = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length <= PERFIL_LIMITES.email, {
    message: `E-mail de contato: máximo de ${PERFIL_LIMITES.email} caracteres.`,
  })
  .refine((v) => v === '' || z.string().email().safeParse(v).success, {
    message: 'E-mail de contato: endereço inválido.',
  });

const Site = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length <= PERFIL_LIMITES.website, {
    message: `Site: máximo de ${PERFIL_LIMITES.website} caracteres.`,
  })
  .refine(
    (v) => {
      if (v === '') return true;
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        return false;
      }
      // Só http/https. `javascript:` num campo que vira link clicável no app do
      // paciente é a razão de esta lista ser de permissão, não de bloqueio.
      return url.protocol === 'http:' || url.protocol === 'https:';
    },
    { message: 'Site: informe uma URL completa começando com http:// ou https://.' },
  );

/**
 * `.strict()` — campo desconhecido é RECUSADO, não descartado em silêncio.
 * Descartar deixaria quem mandou `profile_picture_url` (fora de escopo, §33.6)
 * achando que a foto foi trocada.
 */
export const PerfilWhatsappSchema = z
  .object({
    about: textoLivre(PERFIL_LIMITES.about, 'Recado'),
    description: textoLivre(PERFIL_LIMITES.description, 'Descrição'),
    address: textoLivre(PERFIL_LIMITES.address, 'Endereço'),
    email: EmailContato,
    // `.max()` no array, e não `.slice()`: mandar três sites e receber dois
    // salvos sem aviso é a mesma classe de silêncio que o `.strict()` fecha.
    websites: z.array(Site).max(PERFIL_LIMITES.websites, {
      message: `Sites: no máximo ${PERFIL_LIMITES.websites}.`,
    }),
    vertical: z.enum(PERFIL_VERTICALS, {
      error: 'Categoria: valor fora da lista aceita pela Meta.',
    }),
  })
  .strict()
  // Sites vazios são removidos DEPOIS da validação individual, para que uma URL
  // inválida na primeira linha não seja perdoada por a segunda estar em branco.
  .transform((v) => ({ ...v, websites: v.websites.filter((s) => s !== '') }));

/** O que a tela envia. `z.input` porque o transform muda o tipo de saída. */
export type PerfilWhatsappInput = z.input<typeof PerfilWhatsappSchema>;
/** O que a Meta recebe e devolve. */
export type PerfilWhatsapp = z.output<typeof PerfilWhatsappSchema>;

/** Campos comparáveis do perfil, na ordem em que a tela os mostra. */
export const PERFIL_CAMPOS = [
  'about',
  'description',
  'address',
  'email',
  'websites',
  'vertical',
] as const;

export type PerfilCampo = (typeof PERFIL_CAMPOS)[number];
export type PerfilCampoAuditavel = PerfilCampo | 'profile_picture';

/**
 * Nomes dos campos que mudaram entre dois perfis.
 *
 * Devolve NOME, nunca valor: §33.7 manda auditar o que mudou sem despejar prosa
 * livre no `audit_events`. O conteúdo é público, mas registrar cada versão de
 * cada texto transformaria a auditoria num histórico de redação — e o que a
 * forense precisa saber é quem mexeu em quê, quando.
 */
export function camposAlterados(antes: PerfilWhatsapp, depois: PerfilWhatsapp): PerfilCampo[] {
  return PERFIL_CAMPOS.filter((campo) => {
    if (campo === 'websites') {
      // Ordem importa: a Meta exibe os sites na ordem enviada, então trocar a
      // ordem é uma alteração de verdade, não ruído de comparação.
      const a = antes.websites;
      const b = depois.websites;
      return a.length !== b.length || a.some((v, i) => v !== b[i]);
    }
    return antes[campo] !== depois[campo];
  });
}

/** Perfil vazio — usado só como base de comparação, NUNCA para preencher a tela. */
export const PERFIL_VAZIO: PerfilWhatsapp = {
  about: '',
  description: '',
  address: '',
  email: '',
  websites: [],
  vertical: 'UNDEFINED',
};

/**
 * Resultado de uma leitura do perfil na Meta.
 *
 * Vive no contrato, e não no módulo `internal/` que fala com o Graph, porque a
 * tela precisa deste tipo — e a tela não deve alcançar o `internal/` de um
 * contexto para saber o formato do que recebe.
 */
export interface PerfilLido {
  perfil: PerfilWhatsapp;
  /** URL temporária/CDN que a Meta informa para a foto publicada. */
  profilePictureUrl: string | null;
  /** Identidade do número. O nome é aprovado pela Meta e não é campo editável deste endpoint. */
  identidade: {
    displayName: string;
    displayPhoneNumber: string;
  };
  /**
   * `vertical` que a Meta devolveu e que NÃO está na lista conhecida, ou `null`.
   *
   * A Meta acrescenta valores ao enum sem aviso. Normalizar para `UNDEFINED` e
   * ficar quieto faria a tela exibir uma categoria que não é a real e, pior,
   * transformaria qualquer salvamento num apagamento silencioso da escolha da
   * clínica. Como a escrita só envia campo ALTERADO, o valor desconhecido é
   * preservado — e este campo existe para a tela poder dizer isso em voz alta.
   */
  verticalDesconhecida: string | null;
}
