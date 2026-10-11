'use client';

import {
  Building2,
  Camera,
  ExternalLink,
  Globe,
  Link as LinkIcon,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition, type ChangeEvent } from 'react';

import {
  isPerfilFotoMime,
  PERFIL_AVISO_PUBLICO,
  PERFIL_FOTO_MAX_BYTES,
  PERFIL_FOTO_MAX_LABEL,
  PERFIL_FOTO_MIN_PX,
  PERFIL_FOTO_MIME,
  PERFIL_LIMITES,
  PERFIL_VERTICAL_RECOMENDADA,
  PERFIL_VERTICALS,
  type PerfilLido,
  type PerfilVertical,
  type PerfilWhatsappInput,
} from '@/contexts/messaging/business-profile-contract';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { initialsFrom } from '@/components/ui/avatar';
import { cn } from '@/lib/ui/cn';

import {
  readWhatsappProfileAction,
  saveWhatsappProfileAction,
  uploadWhatsappProfilePictureAction,
} from './actions';

export type PerfilCarregado = { ok: true; lido: PerfilLido } | { ok: false; message: string };

const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/phone-numbers/';
const FOTO_ACCEPT = Object.keys(PERFIL_FOTO_MIME).join(',');

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

function formularioVazio(): Formulario {
  return {
    about: '',
    description: '',
    address: '',
    email: '',
    site1: '',
    site2: '',
    vertical: 'UNDEFINED',
  };
}

function paraEnvio(f: Formulario): PerfilWhatsappInput {
  return {
    about: f.about,
    description: f.description,
    address: f.address,
    email: f.email,
    websites: [f.site1, f.site2].filter((site) => site.trim() !== ''),
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

function PreviewItem({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 text-(length:--fs-xs) text-fg-muted">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function WhatsappProfilePreview({
  lido,
  form,
  photoUrl,
}: {
  lido: PerfilLido;
  form: Formulario;
  photoUrl: string | null;
}) {
  const name = lido.identidade.displayName.trim() || 'Sua clínica';
  const sites = [form.site1, form.site2].filter((site) => site.trim() !== '');

  return (
    <aside className="xl:sticky xl:top-(--sp-4) xl:self-start" aria-label="Prévia do perfil">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h5 className="text-(length:--fs-sm) font-semibold text-fg">Prévia do perfil</h5>
          <p className="text-(length:--fs-xs) text-fg-subtle">Atualiza enquanto você edita</p>
        </div>
        <span className="rounded-full border border-border bg-surface px-2 py-1 text-(length:--fs-2xs) font-medium text-fg-muted">
          aproximada
        </span>
      </div>

      <div
        data-slot="whatsapp-profile-preview"
        className="overflow-hidden rounded-[28px] border border-border bg-surface shadow-[0_18px_50px_-28px_oklch(0.35_0.04_210/0.38)]"
      >
        <div className="bg-[oklch(0.42_0.09_190)] px-5 pb-14 pt-5 text-white">
          <div className="flex items-center gap-2 text-(length:--fs-xs) font-medium text-white/85">
            <MessageCircle aria-hidden="true" className="size-4" />
            Perfil comercial
          </div>
        </div>

        <div className="px-5 pb-5">
          <div className="-mt-10 mb-3 flex items-end justify-between gap-3">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-surface bg-(--primary-soft) text-lg font-semibold text-(--primary-active) shadow-sm">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica vem da Meta ou de blob local.
                <img
                  src={photoUrl}
                  alt={`Foto pública de ${name}`}
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initialsFrom(name)
              )}
            </div>
            <div className="mb-1 rounded-full bg-[oklch(0.9_0.07_160)] px-2.5 py-1 text-(length:--fs-2xs) font-semibold text-[oklch(0.35_0.09_160)]">
              Empresa
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <h6 className="min-w-0 truncate text-(length:--fs-subsection) font-semibold text-fg">
              {name}
            </h6>
          </div>
          <p className="mt-0.5 text-(length:--fs-xs) text-fg-subtle">
            {lido.identidade.displayPhoneNumber || 'Número do WhatsApp'}
          </p>
          <p className="mt-3 text-pretty text-(length:--fs-sm) text-fg-muted">
            {form.about.trim() || 'Seu recado aparecerá aqui.'}
          </p>

          <div className="my-4 h-px bg-border" />

          <div className="flex flex-col gap-3">
            <PreviewItem icon={Building2}>
              {VERTICAL_LABEL[form.vertical] || 'Categoria não definida'}
            </PreviewItem>
            {form.description.trim() ? (
              <PreviewItem icon={MessageCircle}>{form.description.trim()}</PreviewItem>
            ) : null}
            {form.address.trim() ? (
              <PreviewItem icon={MapPin}>{form.address.trim()}</PreviewItem>
            ) : null}
            {form.email.trim() ? <PreviewItem icon={Mail}>{form.email.trim()}</PreviewItem> : null}
            {sites.map((site) => (
              <PreviewItem key={site} icon={LinkIcon}>
                {site.trim()}
              </PreviewItem>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 text-pretty text-(length:--fs-2xs) leading-relaxed text-fg-subtle">
        O WhatsApp pode variar a ordem e a aparência conforme o aparelho. Depois de salvar, o Qoro
        relê o estado publicado pela Meta.
      </p>
    </aside>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const photoBlobRef = useRef<string | null>(null);
  const [lido, setLido] = useState<PerfilLido | null>(inicial.ok ? inicial.lido : null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(
    inicial.ok ? null : inicial.message,
  );
  const [form, setForm] = useState<Formulario>(() =>
    inicial.ok ? paraFormulario(inicial.lido) : formularioVazio(),
  );
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<{ code: string; message: string } | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const [photoPending, startPhotoTransition] = useTransition();

  useEffect(
    () => () => {
      if (photoBlobRef.current) URL.revokeObjectURL(photoBlobRef.current);
    },
    [],
  );

  const campo = <K extends keyof Formulario>(key: K, value: Formulario[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const limparPhotoPreview = (): void => {
    if (photoBlobRef.current) URL.revokeObjectURL(photoBlobRef.current);
    photoBlobRef.current = null;
    setPhotoPreviewUrl(null);
  };

  const recarregar = (): void => {
    setErroGeral(null);
    startTransition(async () => {
      const result = await readWhatsappProfileAction();
      if (!result.ok) {
        setErroLeitura(result.message);
        setLido(null);
        return;
      }
      setErroLeitura(null);
      setLido(result.data);
      setForm(paraFormulario(result.data));
      setErros({});
    });
  };

  const salvar = (): void => {
    setErros({});
    setErroGeral(null);
    startTransition(async () => {
      const result = await saveWhatsappProfileAction(paraEnvio(form));
      if (!result.ok) {
        if (result.fields) setErros(result.fields);
        setErroGeral({ code: result.code, message: result.message });
        return;
      }
      setLido(result.data);
      setForm(paraFormulario(result.data));
      toast.success(
        result.data.alterados.length === 0
          ? 'Nada mudou no perfil.'
          : 'Perfil do WhatsApp atualizado.',
        result.data.alterados.length === 0
          ? 'Os campos enviados são iguais aos que já estavam publicados.'
          : 'A alteração já vale para quem abrir a conversa com a clínica.',
      );
    });
  };

  const onPickPhoto = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isPerfilFotoMime(file.type)) {
      toast.error('Formato inválido. Use PNG ou JPG.');
      return;
    }
    if (file.size > PERFIL_FOTO_MAX_BYTES) {
      toast.error(`Imagem muito grande (máx. ${PERFIL_FOTO_MAX_LABEL}).`);
      return;
    }

    const preview = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth < PERFIL_FOTO_MIN_PX || image.naturalHeight < PERFIL_FOTO_MIN_PX) {
        URL.revokeObjectURL(preview);
        toast.error(
          `Imagem pequena demais (${image.naturalWidth}×${image.naturalHeight}px). Use ao menos ${PERFIL_FOTO_MIN_PX}×${PERFIL_FOTO_MIN_PX}px.`,
        );
        return;
      }

      limparPhotoPreview();
      photoBlobRef.current = preview;
      setPhotoPreviewUrl(preview);
      const formData = new FormData();
      formData.append('file', file);

      startPhotoTransition(async () => {
        const result = await uploadWhatsappProfilePictureAction(formData);
        if (!result.ok) {
          limparPhotoPreview();
          toast.error(result.message);
          return;
        }
        setLido(result.data);
        limparPhotoPreview();
        toast.success('Foto do WhatsApp atualizada.');
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(preview);
      toast.error('Não foi possível ler a imagem. Envie um PNG ou JPG válido.');
    };
    image.src = preview;
  };

  const salvo = lido ? paraFormulario(lido) : null;
  const alterado = salvo ? !iguais(form, salvo) : false;
  const photoUrl = photoPreviewUrl ?? lido?.profilePictureUrl ?? null;

  return (
    <Card
      role="region"
      aria-labelledby={`${id}-titulo`}
      data-slot="whatsapp-profile"
      data-profile-state={lido ? 'carregado' : 'erro-leitura'}
      data-profile-read-only={somenteLeitura ? 'true' : 'false'}
      className="mt-(--sp-4) overflow-hidden"
    >
      <header className="border-b border-border bg-surface-2 px-(--card-pad) py-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-(--r-md) border border-border bg-surface text-primary shadow-xs">
            <Globe aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <h4
              id={`${id}-titulo`}
              className="text-balance text-(length:--fs-subsection) font-semibold"
            >
              Perfil público do WhatsApp
            </h4>
            <p className="mt-1 max-w-2xl text-pretty text-(length:--fs-sm) text-fg-muted">
              {somenteLeitura
                ? 'Veja o perfil que pacientes encontram no WhatsApp Business.'
                : 'Ajuste o que pacientes veem antes de iniciar uma conversa com a clínica.'}
            </p>
          </div>
        </div>
      </header>

      <div className="p-(--card-pad)">
        {erroLeitura ? (
          <Alert variant="danger" title="Não foi possível ler o perfil">
            <p className="text-pretty">{erroLeitura}</p>
            <p className="mt-1.5 text-pretty text-(length:--fs-xs) text-fg-muted">
              O formulário fica oculto porque editar sem saber o que está publicado apagaria o
              conteúdo atual.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-(--sp-3)"
              onClick={recarregar}
              loading={pendente}
            >
              Tentar de novo
            </Button>
          </Alert>
        ) : lido ? (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <Alert variant="warning" title="Estas informações são públicas" className="mb-5">
                <p className="text-pretty">{PERFIL_AVISO_PUBLICO}</p>
              </Alert>

              {somenteLeitura ? (
                <Alert variant="info" title="Gerenciado no WhatsApp Business" className="mb-5">
                  <p className="text-pretty">
                    Como este número está conectado por coexistência, altere nome, foto e dados
                    públicos diretamente no aplicativo WhatsApp Business do celular. O Qoro mostra
                    aqui o perfil que a Meta informa, sem tentar sobrescrevê-lo.
                  </p>
                </Alert>
              ) : null}

              {lido.verticalDesconhecida ? (
                <Alert variant="info" title="Categoria definida fora do Qoro" className="mb-5">
                  <p className="text-pretty">
                    A Meta reporta <span className="font-mono">{lido.verticalDesconhecida}</span>.
                    Ela será preservada enquanto você não escolher outra categoria.
                  </p>
                </Alert>
              ) : null}

              {erroGeral ? (
                <Alert variant="danger" title="Não foi possível salvar" className="mb-5">
                  <p className="text-pretty">{erroGeral.message}</p>
                  <p className="mt-1.5 font-mono text-(length:--fs-2xs) text-fg-subtle">
                    Código: {erroGeral.code}
                  </p>
                </Alert>
              ) : null}

              <fieldset disabled={somenteLeitura} className="min-w-0 border-0 p-0">
                <section aria-labelledby={`${id}-identidade`} className="mb-6">
                  <div className="mb-3">
                    <h5
                      id={`${id}-identidade`}
                      className="text-(length:--fs-sm) font-semibold text-fg"
                    >
                      Identidade
                    </h5>
                    <p className="mt-0.5 text-(length:--fs-xs) text-fg-muted">
                      Foto e nome que ajudam o paciente a reconhecer a clínica.
                    </p>
                  </div>

                  <div className="rounded-(--r-lg) border border-border bg-surface-2 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-surface bg-(--primary-soft) text-lg font-semibold text-(--primary-active) shadow-[0_0_0_1px_var(--border)]">
                        {photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica vem da Meta ou de blob local.
                          <img
                            src={photoUrl}
                            alt="Foto atual do perfil do WhatsApp"
                            className="size-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          initialsFrom(lido.identidade.displayName || 'Sua clínica')
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-(length:--fs-sm) font-medium text-fg">Foto do perfil</p>
                        <p className="mt-0.5 text-pretty text-(length:--fs-xs) text-fg-muted">
                          PNG ou JPG, até {PERFIL_FOTO_MAX_LABEL}, com no mínimo{' '}
                          {PERFIL_FOTO_MIN_PX}×{PERFIL_FOTO_MIN_PX}px. Não envie foto de paciente.
                        </p>
                        <input
                          ref={fileRef}
                          type="file"
                          accept={FOTO_ACCEPT}
                          className="hidden"
                          onChange={onPickPhoto}
                          disabled={somenteLeitura}
                          aria-label="Selecionar foto do perfil"
                        />
                        {somenteLeitura ? null : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mt-3"
                            onClick={() => fileRef.current?.click()}
                            loading={photoPending}
                          >
                            <Camera aria-hidden="true" className="size-4" />
                            {lido.profilePictureUrl ? 'Trocar foto' : 'Adicionar foto'}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="my-4 h-px bg-border" />

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <Field
                        label="Nome exibido no WhatsApp"
                        htmlFor={`${id}-display-name`}
                        hint="O nome passa por revisão da Meta e não muda junto com os campos abaixo."
                      >
                        <Input
                          id={`${id}-display-name`}
                          value={lido.identidade.displayName || 'Nome não informado pela Meta'}
                          readOnly
                          className="bg-surface text-fg-muted"
                        />
                      </Field>
                      <a
                        href={WHATSAPP_MANAGER_URL}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          buttonVariants({ variant: 'secondary', size: 'sm' }),
                          'w-full sm:w-auto',
                        )}
                      >
                        Alterar nome na Meta
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-(length:--fs-xs)">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-fg-muted">
                        <Building2 aria-hidden="true" className="size-3.5" />
                        Nome gerenciado pela Meta
                      </span>
                      {lido.identidade.displayPhoneNumber ? (
                        <span className="inline-flex items-center gap-1.5 text-fg-muted">
                          <Phone aria-hidden="true" className="size-3.5" />
                          {lido.identidade.displayPhoneNumber}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section aria-labelledby={`${id}-conteudo`}>
                  <div className="mb-3">
                    <h5
                      id={`${id}-conteudo`}
                      className="text-(length:--fs-sm) font-semibold text-fg"
                    >
                      Informações públicas
                    </h5>
                    <p className="mt-0.5 text-(length:--fs-xs) text-fg-muted">
                      A prévia ao lado acompanha cada alteração antes de publicar.
                    </p>
                  </div>

                  <div className="grid gap-4">
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
                        onChange={(event) => campo('about', event.target.value)}
                        placeholder="Atendimento em saúde mental"
                      />
                    </Field>

                    <Field
                      label="Descrição"
                      htmlFor={`${id}-description`}
                      error={erros.description}
                      hint={`Explique o que a clínica faz. ${form.description.trim().length}/${PERFIL_LIMITES.description}`}
                    >
                      <Textarea
                        id={`${id}-description`}
                        value={form.description}
                        maxLength={PERFIL_LIMITES.description}
                        invalid={Boolean(erros.description)}
                        onChange={(event) => campo('description', event.target.value)}
                        rows={4}
                      />
                    </Field>

                    <div className="grid gap-4 md:grid-cols-2">
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
                          onChange={(event) => campo('address', event.target.value)}
                          rows={3}
                        />
                      </Field>

                      <Field
                        label="E-mail de contato da clínica"
                        htmlFor={`${id}-email`}
                        error={erros.email}
                        hint="Nunca use o e-mail de um paciente."
                      >
                        <Input
                          id={`${id}-email`}
                          type="email"
                          inputMode="email"
                          autoComplete="off"
                          value={form.email}
                          maxLength={PERFIL_LIMITES.email}
                          invalid={Boolean(erros.email)}
                          onChange={(event) => campo('email', event.target.value)}
                          placeholder="contato@suaclinica.com.br"
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field
                        label="Sites"
                        htmlFor={`${id}-site1`}
                        error={erros.websites}
                        hint={`Até ${PERFIL_LIMITES.websites}, com http:// ou https://.`}
                      >
                        <div className="flex flex-col gap-2">
                          <Input
                            id={`${id}-site1`}
                            type="url"
                            inputMode="url"
                            value={form.site1}
                            maxLength={PERFIL_LIMITES.website}
                            invalid={Boolean(erros.websites)}
                            onChange={(event) => campo('site1', event.target.value)}
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
                            onChange={(event) => campo('site2', event.target.value)}
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
                          onChange={(event) =>
                            campo('vertical', event.target.value as PerfilVertical)
                          }
                        >
                          {PERFIL_VERTICALS.map((vertical) => (
                            <option key={vertical} value={vertical}>
                              {VERTICAL_LABEL[vertical]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  </div>
                </section>

                {somenteLeitura ? null : (
                  <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
                    <Button type="button" onClick={salvar} disabled={!alterado} loading={pendente}>
                      Salvar perfil
                    </Button>
                    <span className="text-(length:--fs-xs) text-fg-muted">
                      {alterado ? 'Alterações ainda não publicadas.' : 'Tudo salvo na Meta.'}
                    </span>
                  </div>
                )}
              </fieldset>
            </div>

            <WhatsappProfilePreview lido={lido} form={form} photoUrl={photoUrl} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
