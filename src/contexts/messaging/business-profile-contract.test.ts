/**
 * §33.8 — "Contrato dos limites": 139/512/256/128, 2 sites, vertical fora do
 * enum recusada.
 *
 * Este arquivo é a única defesa contra a classe de erro que a §33.2 antecipou:
 * limite local divergente do limite da Meta. Ele não prova que a Meta aceita —
 * isso só o round-trip real prova —, mas prova que o que passa daqui está dentro
 * do que a spec registrou, e que o que não passa recebe mensagem por campo.
 */
import { describe, expect, it } from 'vitest';

import {
  camposAlterados,
  PERFIL_CAMPOS,
  PERFIL_LIMITES,
  PERFIL_VERTICALS,
  PerfilWhatsappSchema,
  PERFIL_VAZIO,
  type PerfilWhatsapp,
} from './business-profile-contract';

/** Base válida mínima — cada teste muda um campo só. */
const base = {
  about: 'Atendimento em saúde mental',
  description: 'Clínica de psiquiatria e psicologia.',
  address: 'Rua das Flores, 100 - São Paulo/SP',
  email: 'contato@clinica.com.br',
  websites: ['https://clinica.com.br'],
  vertical: 'HEALTH' as const,
};

const repetir = (n: number): string => 'a'.repeat(n);

describe('PerfilWhatsappSchema — limites por campo', () => {
  it.each([
    ['about', PERFIL_LIMITES.about],
    ['description', PERFIL_LIMITES.description],
    ['address', PERFIL_LIMITES.address],
  ] as const)('aceita %s exatamente no limite (%i) e recusa um a mais', (campo, limite) => {
    expect(PerfilWhatsappSchema.safeParse({ ...base, [campo]: repetir(limite) }).success).toBe(
      true,
    );

    const estourado = PerfilWhatsappSchema.safeParse({ ...base, [campo]: repetir(limite + 1) });
    expect(estourado.success).toBe(false);
    if (estourado.success) return;
    // A mensagem tem de citar o limite: "inválido" sozinho manda a pessoa
    // adivinhar quanto cortar.
    expect(estourado.error.issues[0]?.message).toContain(String(limite));
    expect(estourado.error.issues[0]?.path[0]).toBe(campo);
  });

  it('recusa e-mail acima de 128 caracteres mesmo sendo sintaticamente válido', () => {
    const local = repetir(PERFIL_LIMITES.email - '@exemplo.com.br'.length + 1);
    const email = `${local}@exemplo.com.br`;
    expect(email.length).toBeGreaterThan(PERFIL_LIMITES.email);

    const r = PerfilWhatsappSchema.safeParse({ ...base, email });
    expect(r.success).toBe(false);
  });

  it('recusa e-mail sintaticamente inválido', () => {
    const r = PerfilWhatsappSchema.safeParse({ ...base, email: 'contato arroba clinica' });
    expect(r.success).toBe(false);
  });

  it('aceita e-mail vazio — vazio significa apagar o campo, não erro', () => {
    const r = PerfilWhatsappSchema.safeParse({ ...base, email: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('');
  });

  it('recusa três sites e aceita dois', () => {
    const dois = ['https://a.com.br', 'https://b.com.br'];
    expect(PerfilWhatsappSchema.safeParse({ ...base, websites: dois }).success).toBe(true);

    const tres = PerfilWhatsappSchema.safeParse({
      ...base,
      websites: [...dois, 'https://c.com.br'],
    });
    expect(tres.success).toBe(false);
    if (!tres.success) expect(tres.error.issues[0]?.path[0]).toBe('websites');
  });

  it('recusa site acima de 256 caracteres', () => {
    const longo = `https://exemplo.com.br/${repetir(PERFIL_LIMITES.website)}`;
    expect(PerfilWhatsappSchema.safeParse({ ...base, websites: [longo] }).success).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>',
    'ftp://arquivos.com',
    'clinica.com.br',
  ])('recusa o site %s — só http e https entram num campo que vira link clicável', (site) => {
    expect(PerfilWhatsappSchema.safeParse({ ...base, websites: [site] }).success).toBe(false);
  });

  it('recusa URL inválida na primeira posição mesmo com a segunda vazia', () => {
    // O filtro de vazios roda DEPOIS da validação individual: se rodasse antes,
    // um vazio na lista poderia mascarar o item inválido ao lado.
    const r = PerfilWhatsappSchema.safeParse({ ...base, websites: ['nao-e-url', ''] });
    expect(r.success).toBe(false);
  });

  it('descarta sites vazios do resultado, preservando a ordem dos que sobram', () => {
    const r = PerfilWhatsappSchema.safeParse({
      ...base,
      websites: ['', 'https://segundo.com.br'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.websites).toEqual(['https://segundo.com.br']);
  });
});

describe('PerfilWhatsappSchema — vertical', () => {
  it('aceita todos os valores do enum documentado', () => {
    for (const v of PERFIL_VERTICALS) {
      expect(PerfilWhatsappSchema.safeParse({ ...base, vertical: v }).success).toBe(true);
    }
  });

  it('recusa vertical fora do enum', () => {
    const r = PerfilWhatsappSchema.safeParse({ ...base, vertical: 'MEDICAL_CLINIC' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path[0]).toBe('vertical');
  });
});

describe('PerfilWhatsappSchema — .strict() e normalização', () => {
  it('RECUSA campo desconhecido em vez de descartar em silêncio', () => {
    // §33.6 — foto de perfil está fora de escopo. Descartar deixaria quem
    // mandou `profile_picture_url` achando que a foto foi trocada.
    const r = PerfilWhatsappSchema.safeParse({
      ...base,
      profile_picture_url: 'https://exemplo.com/foto.png',
    });
    expect(r.success).toBe(false);
  });

  it('aplica trim sem alterar o miolo do texto', () => {
    const r = PerfilWhatsappSchema.safeParse({ ...base, about: '  Saúde mental  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.about).toBe('Saúde mental');
  });

  it('remove CR de CRLF para o diff não acusar alteração inexistente', () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    const r = PerfilWhatsappSchema.safeParse({
      ...base,
      description: `linha um${cr}${lf}linha dois`,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBe(`linha um${lf}linha dois`);
  });

  it.each([0, 8, 27, 127])('recusa o caractere de controle %i', (code) => {
    const r = PerfilWhatsappSchema.safeParse({
      ...base,
      about: `texto${String.fromCharCode(code)}oculto`,
    });
    expect(r.success).toBe(false);
  });

  it('aceita tabulação e quebra de linha — descrição e endereço têm linha', () => {
    const r = PerfilWhatsappSchema.safeParse({
      ...base,
      address: `Rua A, 1${String.fromCharCode(10)}Sala 2${String.fromCharCode(9)}Bloco B`,
    });
    expect(r.success).toBe(true);
  });
});

describe('camposAlterados', () => {
  const p = (over: Partial<PerfilWhatsapp> = {}): PerfilWhatsapp => ({ ...PERFIL_VAZIO, ...over });

  it('não acusa alteração entre perfis iguais', () => {
    expect(camposAlterados(p({ about: 'x' }), p({ about: 'x' }))).toEqual([]);
  });

  it('acusa só o campo que mudou', () => {
    expect(camposAlterados(p({ about: 'a' }), p({ about: 'b' }))).toEqual(['about']);
  });

  it('trata reordenar sites como alteração — a Meta exibe na ordem enviada', () => {
    const antes = p({ websites: ['https://a.com', 'https://b.com'] });
    const depois = p({ websites: ['https://b.com', 'https://a.com'] });
    expect(camposAlterados(antes, depois)).toEqual(['websites']);
  });

  it('acusa remoção de um site', () => {
    const antes = p({ websites: ['https://a.com', 'https://b.com'] });
    expect(camposAlterados(antes, p({ websites: ['https://a.com'] }))).toEqual(['websites']);
  });

  it('devolve os campos na ordem da tela, não na ordem em que mudaram', () => {
    const antes = p();
    const depois = p({ vertical: 'HEALTH', about: 'novo', email: 'a@b.com' });
    expect(camposAlterados(antes, depois)).toEqual(['about', 'email', 'vertical']);
  });

  it('cobre todos os campos do perfil — nenhum escapa do diff', () => {
    const antes = p();
    const depois = p({
      about: 'a',
      description: 'd',
      address: 'e',
      email: 'x@y.com',
      websites: ['https://z.com'],
      vertical: 'HEALTH',
    });
    expect(camposAlterados(antes, depois)).toEqual([...PERFIL_CAMPOS]);
  });
});
