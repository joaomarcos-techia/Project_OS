'use client';

/**
 * Perfil público do WhatsApp da clínica (§33).
 *
 * A Meta é a fonte da verdade: esta tela não guarda nada. Ela recebe o que foi
 * lido no servidor, escreve na Meta ao salvar e passa a exibir o que a Meta
 * respondeu depois — nunca o que foi enviado.
 *
 * A regra de desenho que governa o arquivo inteiro está no §33.5: **formulário
 * vazio por erro de leitura é uma armadilha.** Quando o GET falha, o passo
 * seguinte natural de quem vê campos em branco é preencher e salvar — apagando
 * o que já estava publicado. Por isso a falha de leitura tem um ramo próprio,
 * sem formulário nenhum.
 */
import { Globe } from 'lucide-react';
import { useId, useState, useTransition } from 'react';

import {
  PERFIL_AVISO_PUBLICO,
  PERFIL_LIMITES,
  PERFIL_VERTICAL_RECOMENDADA,
  PERFIL_VERTICALS,
  type PerfilLido,
  type PerfilVertical,
  type PerfilWhatsappInput,
} from '@/contexts/messaging/business-profile-contract';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import { readWhatsappProfileAction, saveWhatsappProfileAction } from './actions';

/** Estado com que a página entrega esta seção. */
export type PerfilCarregado = { ok: true; lido: PerfilLido } | { ok: false; message: string };

/** Rótulos pt-BR do enum fechado da Meta. */
const VERTICAL_LABEL: Record<PerfilVertical, string> = {
  UNDEFINED: 'Não definida',
  OTHER: 'Outra',
  AUTO: 'Automotivo',
  BEAUTY: 'Beleza e bem-estar',
  APPAREL: 'Vestuário',
  EDU: 'Educação',
  ENTERTAIN: 'Entretenimento',
  EVENT_PLAN: 'Eventos',
  FINANCE: 'Finanças',
  GROCERY: 'Mercado',
  GOVT: 'Governo',
  HOTEL: 'Hotelaria',
  HEALTH: 'Saúde',
  NONPROFIT: 'Organização sem fins lucrativos',
  PROF_SERVICES: 'Serviços profissionais',
  RETAIL: 'Varejo',
  TRAVEL: 'Viagens',
  RESTAURANT: 'Restaurante',
  NOT_A_BIZ: 'Não é uma empresa',
};

/** Formulário em memória. Os dois sites viram campos separados. */
interface Formulario {
  about: string;
  description: string;
  address: string;
  email: string;
  site1: string;
  site2: string;
  vertical: PerfilVertical;
}

function paraFormulario(lido: PerfilLido): Formulario {
  const { perfil } = lido;
  return {
    about: perfil.about,
    description: perfil.description,
    address: perfil.address,
    email: perfil.email,
    site1: perfil.websites[0] ?? '',
    site2: perfil.websites[1] ?? '',
    vertical: perfil.vertical,
  };
}

/**
 * Os dois campos de site viram a lista que o contrato espera.
 *
 * Preservar a ORDEM e descartar vazios só no fim importa: se alguém limpar o
 * primeiro site e mantiver o segundo, o que sobra tem de ser o segundo, não um
 * buraco — e a Meta exibe os sites na ordem recebida.
 */
function paraEnvio(f: Formulario): PerfilWhatsappInput {
  return {
    about: f.about,
    description: f.description,
    address: f.address,
    email: f.email,
    websites: [f.site1, f.site2].filter((s) => s.trim() !== ''),
    vertical: f.vertical,
  };
}

function iguais(a: Formulario, b: Formulario): boolean {
  return (
    a.about.trim() === b.about.trim() &&
    a.description.trim() === b.description.trim() &&
    a.address.trim() === b.address.trim() &&
    a.email.trim() === b.email.trim() &&
    a.site1.trim() === b.site1.trim() &&
    a.site2.trim() === b.site2.trim() &&
    a.vertical === b.vertical
  );
}

export function WhatsappProfile({
  inicial,
  somenteLeitura = false,
}: {
  inicial: PerfilCarregado;
  somenteLeitura?: boolean;
}) {
  const id = useId();
  const [lido, setLido] = useState<PerfilLido | null>(inicial.ok ? inicial.lido : null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(
    inicial.ok ? null : inicial.message,
  );
  const [form, setForm] = useState<Formulario>(() =>
    inicial.ok
      ? paraFormulario(inicial.lido)
      : {
          about: '',
          description: '',
          address: '',
          email: '',
          site1: '',
          site2: '',
          vertical: 'UNDEFINED',
        },
  );
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<{ code: string; message: string } | null>(null);
  const [pendente, startTransition] = useTransition();

  const campo = <K extends keyof Formulario>(k: K, v: Formulario[K]): void => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const recarregar = (): void => {
    setErroGeral(null);
    startTransition(async () => {
      const r = await readWhatsappProfileAction();
      if (!r.ok) {
        setErroLeitura(r.message);
        setLido(null);
        return;
      }
      setErroLeitura(null);
      setLido(r.data);
      setForm(paraFormulario(r.data));
      setErros({});
    });
  };

  const salvar = (): void => {
    setErros({});
    setErroGeral(null);
    startTransition(async () => {
      const r = await saveWhatsappProfileAction(paraEnvio(form));
      if (!r.ok) {
        // Validação recusada NÃO limpa o formulário: o texto que a pessoa
        // escreveu é o que ela precisa corrigir, e nada foi enviado à Meta.
        if (r.fields) setErros(r.fields);
        setErroGeral({ code: r.code, message: r.message });
        return;
      }
      // O que passa a valer é o que a Meta devolveu na releitura, não o que
      // saiu daqui. Se alguém editou pelo Business Manager no meio, é agora
      // que a tela para de mentir.
      setLido(r.data);
      setForm(paraFormulario(r.data));
      toast.success(
        r.data.alterados.length === 0 ? 'Nada mudou no perfil.' : 'Perfil do WhatsApp atualizado.',
        r.data.alterados.length === 0
          ? 'Os campos enviados são iguais aos que já estavam publicados.'
          : 'A alteração já vale para quem abrir a conversa com a clínica.',
      );
    });
  };

  const salvo = lido ? paraFormulario(lido) : null;
  const alterado = salvo ? !iguais(form, salvo) : false;

  return (
    <Card
      role="region"
      aria-labelledby={`${id}-titulo`}
      data-slot="whatsapp-profile"
      data-profile-state={lido ? 'carregado' : 'erro-leitura'}
      data-profile-read-only={somenteLeitura ? 'true' : 'false'}
      className="mt-(--sp-4) max-w-190 p-(--card-pad)"
    >
      <div className="mb-(--sp-3) flex items-center justify-between gap-(--sp-3)">
        <h4
          id={`${id}-titulo`}
          className="flex items-center gap-1.5 text-(length:--fs-sm) font-semibold [&>svg]:size-4 [&>svg]:text-fg-subtle"
        >
          <Globe aria-hidden="true" />
          Perfil público
        </h4>
      </div>

      {erroLeitura ? (
        // §33.5 — o ramo que NÃO renderiza formulário. Um formulário vazio aqui
        // pareceria "perfil não configurado" e convidaria a sobrescrever com
        // nada o que já está publicado.
        <Alert variant="danger" title="Não foi possível ler o perfil">
          <p className="text-pretty">{erroLeitura}</p>
          <p className="mt-1.5 text-pretty text-(length:--fs-xs) text-fg-muted">
            O formulário fica oculto de propósito: editar sem saber o que está publicado hoje
            apagaria o conteúdo atual.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-(--sp-3)"
            onClick={recarregar}
            disabled={pendente}
          >
            {pendente ? 'Lendo…' : 'Tentar de novo'}
          </Button>
        </Alert>
      ) : (
        <>
          <Alert variant="warning" title="Este conteúdo é público" className="mb-(--sp-4)">
            <p className="text-pretty">{PERFIL_AVISO_PUBLICO}</p>
          </Alert>

          {somenteLeitura ? (
            <Alert variant="info" title="Gerenciado no WhatsApp Business" className="mb-(--sp-4)">
              <p className="text-pretty">
                Como este número está conectado por coexistência, altere nome, foto e dados públicos
                diretamente no aplicativo WhatsApp Business do celular. O Qoro mostra aqui o perfil
                que a Meta informa, sem tentar sobrescrevê-lo.
              </p>
            </Alert>
          ) : null}

          {lido?.verticalDesconhecida ? (
            <Alert variant="info" title="Categoria definida fora do Qoro" className="mb-(--sp-4)">
              <p className="text-pretty">
                A Meta reporta a categoria{' '}
                <span className="font-mono">{lido.verticalDesconhecida}</span>, que não está na
                lista conhecida aqui. Ela é preservada enquanto você não escolher outra abaixo.
              </p>
            </Alert>
          ) : null}

          {erroGeral ? (
            <Alert variant="danger" title="Não foi possível salvar" className="mb-(--sp-4)">
              <p className="text-pretty">{erroGeral.message}</p>
              <p className="mt-1.5 font-mono text-(length:--fs-2xs) text-fg-subtle">
                Código: {erroGeral.code}
              </p>
            </Alert>
          ) : null}

          <fieldset disabled={somenteLeitura} className="flex flex-col gap-(--sp-4)">
            <Field
              label="Recado"
              htmlFor={`${id}-about`}
              error={erros.about}
              hint={`A linha curta sob o nome da clínica. ${form.about.trim().length}/${PERFIL_LIMITES.about}`}
            >
              <Input
                id={`${id}-about`}
                value={form.about}
                maxLength={PERFIL_LIMITES.about}
                invalid={Boolean(erros.about)}
                onChange={(e) => campo('about', e.target.value)}
                placeholder="Atendimento em saúde mental"
              />
            </Field>

            <Field
              label="Descrição"
              htmlFor={`${id}-description`}
              error={erros.description}
              hint={`O que a clínica faz. ${form.description.trim().length}/${PERFIL_LIMITES.description}`}
            >
              <Textarea
                id={`${id}-description`}
                value={form.description}
                maxLength={PERFIL_LIMITES.description}
                invalid={Boolean(erros.description)}
                onChange={(e) => campo('description', e.target.value)}
                rows={4}
              />
            </Field>

            <Field
              label="Endereço"
              htmlFor={`${id}-address`}
              error={erros.address}
              hint={`${form.address.trim().length}/${PERFIL_LIMITES.address}`}
            >
              <Textarea
                id={`${id}-address`}
                value={form.address}
                maxLength={PERFIL_LIMITES.address}
                invalid={Boolean(erros.address)}
                onChange={(e) => campo('address', e.target.value)}
                rows={2}
              />
            </Field>

            {/*
              §33.3 nº 2 — o rótulo diz "da clínica" de propósito. Um rótulo
              genérico ("E-mail") convida alguém a colar o e-mail de um
              paciente num campo que o mundo inteiro enxerga.
            */}
            <Field
              label="E-mail de contato da clínica"
              htmlFor={`${id}-email`}
              error={erros.email}
              hint="Aparece no perfil para qualquer pessoa. Nunca use o e-mail de um paciente."
            >
              <Input
                id={`${id}-email`}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={form.email}
                maxLength={PERFIL_LIMITES.email}
                invalid={Boolean(erros.email)}
                onChange={(e) => campo('email', e.target.value)}
                placeholder="contato@suaclinica.com.br"
              />
            </Field>

            <Field
              label="Sites"
              htmlFor={`${id}-site1`}
              error={erros.websites}
              hint={`Até ${PERFIL_LIMITES.websites}, com http:// ou https://.`}
            >
              <div className="flex flex-col gap-(--sp-2)">
                <Input
                  id={`${id}-site1`}
                  type="url"
                  inputMode="url"
                  value={form.site1}
                  maxLength={PERFIL_LIMITES.website}
                  invalid={Boolean(erros.websites)}
                  onChange={(e) => campo('site1', e.target.value)}
                  placeholder="https://suaclinica.com.br"
                  aria-label="Primeiro site"
                />
                <Input
                  id={`${id}-site2`}
                  type="url"
                  inputMode="url"
                  value={form.site2}
                  maxLength={PERFIL_LIMITES.website}
                  invalid={Boolean(erros.websites)}
                  onChange={(e) => campo('site2', e.target.value)}
                  placeholder="https://instagram.com/suaclinica"
                  aria-label="Segundo site"
                />
              </div>
            </Field>

            <Field
              label="Categoria"
              htmlFor={`${id}-vertical`}
              error={erros.vertical}
              hint={`Recomendada para clínica: ${VERTICAL_LABEL[PERFIL_VERTICAL_RECOMENDADA]}.`}
            >
              <Select
                id={`${id}-vertical`}
                value={form.vertical}
                invalid={Boolean(erros.vertical)}
                onChange={(e) => campo('vertical', e.target.value as PerfilVertical)}
              >
                {PERFIL_VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {VERTICAL_LABEL[v]}
                  </option>
                ))}
              </Select>
            </Field>
          </fieldset>

          {somenteLeitura ? null : (
            <div className="mt-(--sp-5) flex items-center gap-(--sp-3)">
              <Button type="button" onClick={salvar} disabled={pendente || !alterado}>
                {pendente ? 'Salvando…' : 'Salvar perfil'}
              </Button>
              {alterado ? (
                <span className="text-(length:--fs-xs) text-fg-muted">
                  Alterações ainda não publicadas.
                </span>
              ) : null}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
