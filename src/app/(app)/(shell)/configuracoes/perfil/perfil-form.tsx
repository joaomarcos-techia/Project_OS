'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ChangeEvent } from 'react';

import { updateClinicProfile, uploadClinicLogo } from '@/contexts/tenancy/actions';
import type { ClinicProfile } from '@/contexts/tenancy/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { maskCnpj, maskPhoneBR } from '@/lib/masks';
import { CLINIC_LOGO_MAX_BYTES, CLINIC_LOGO_MAX_LABEL } from '@/lib/storage/clinic-logo-policy';

const ACCEPT = 'image/png,image/jpeg,image/webp';
// Requisito de dimensão: uma logo minúscula fica pixelada/quebrada no receituário.
const MIN_LOGO_PX = 64;

export function PerfilForm({ initial }: { initial: ClinicProfile }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(initial.nome);
  const [endereco, setEndereco] = useState(initial.endereco ?? '');
  const [telefone, setTelefone] = useState(maskPhoneBR(initial.telefone ?? ''));
  const [cnpj, setCnpj] = useState(maskCnpj(initial.cnpj ?? ''));
  const [cnes, setCnes] = useState(initial.cnes ?? '');
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '');
  // Preview local (blob) enquanto o upload sobe — a URL remota do Supabase demora
  // a carregar (item 20). `logoUrl` é o que PERSISTE no save; `previewUrl` é só
  // visual e nunca é gravado. O que a img mostra = previewUrl ?? logoUrl.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const shownLogo = previewUrl ?? logoUrl;
  const [saving, startSave] = useTransition();
  const [uploading, startUpload] = useTransition();

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      return toast.error('Formato inválido. Use PNG, JPG ou WEBP.');
    }
    if (file.size > CLINIC_LOGO_MAX_BYTES) {
      return toast.error(`Imagem muito grande (máx. ${CLINIC_LOGO_MAX_LABEL}).`);
    }
    // Valida a DIMENSÃO antes de subir (o servidor já valida tipo+tamanho; a
    // dimensão só dá pra checar no cliente carregando a imagem). Só sobe se passar.
    const preview = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < MIN_LOGO_PX || h < MIN_LOGO_PX) {
        URL.revokeObjectURL(preview);
        toast.error(
          `Imagem pequena demais (${w}×${h}px). Use uma logo de ao menos ${MIN_LOGO_PX}×${MIN_LOGO_PX}px.`,
        );
        return;
      }
      setPreviewUrl(preview); // válida → preview instantâneo + sobe
      const fd = new FormData();
      fd.append('file', file);
      startUpload(async () => {
        const res = await uploadClinicLogo(fd);
        URL.revokeObjectURL(preview);
        setPreviewUrl(null);
        if (res.ok) {
          setLogoUrl(res.url);
          toast.success('Logo enviado. Clique em “Salvar perfil” para aplicar.');
        } else {
          // Falha NÃO apaga a logo existente — logoUrl fica intacto.
          toast.error(res.message);
        }
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(preview);
      toast.error('Não foi possível ler a imagem. Envie um PNG, JPG ou WEBP válido.');
    };
    img.src = preview;
  }

  function save() {
    if (!nome.trim()) return toast.error('Informe o nome da clínica.');
    startSave(async () => {
      const res = await updateClinicProfile({
        // DATA-005 — a versão que ESTA aba leu. Duas abas do owner salvavam
        // valores diferentes e as duas diziam "Perfil salvo."
        ...(initial.updatedAt ? { expectedUpdatedAt: initial.updatedAt } : {}),
        nome: nome.trim(),
        endereco: endereco.trim() || undefined,
        telefone: telefone.trim() || undefined,
        cnpj: cnpj.trim() || undefined,
        cnes: cnes.trim() || undefined,
        logoUrl: logoUrl.trim(),
      });
      if (res.ok) {
        toast.success('Perfil salvo.');
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="flex max-w-190 flex-col gap-(--sp-4)">
      <Card className="flex flex-col gap-(--sp-4) p-(--card-pad)">
        <div>
          <h2 className="text-(length:--fs-subsection) font-semibold">Dados da clínica</h2>
          <p className="mt-1 text-(length:--fs-body-sm) text-fg-muted">
            Aparecem no cabeçalho do receituário e dos documentos.
          </p>
        </div>
        <Field label="Nome" htmlFor="clinica-nome" required>
          <Input
            id="clinica-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label="Endereço" htmlFor="clinica-endereco">
          <Input
            id="clinica-endereco"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            maxLength={240}
          />
        </Field>
        <div className="grid gap-(--sp-4) sm:grid-cols-3">
          <Field label="Telefone" htmlFor="clinica-telefone">
            <Input
              id="clinica-telefone"
              value={telefone}
              onChange={(e) => setTelefone(maskPhoneBR(e.target.value))}
              type="tel"
              inputMode="tel"
              maxLength={16}
            />
          </Field>
          <Field label="CNPJ" htmlFor="clinica-cnpj">
            <Input
              id="clinica-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              inputMode="numeric"
              maxLength={18}
            />
          </Field>
          <Field label="CNES" htmlFor="clinica-cnes">
            <Input
              id="clinica-cnes"
              value={cnes}
              onChange={(e) => setCnes(e.target.value)}
              maxLength={20}
            />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-(--sp-4) p-(--card-pad)">
        <h2 className="text-(length:--fs-subsection) font-semibold">Logo no receituário</h2>
        <div className="flex items-center gap-(--sp-4)">
          {/* `bg-surface-subtle` não existe como token — a moldura ficava sem
              fundo desde sempre. Agora usa a superfície recuada do DS. */}
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-(--r-md) border border-border bg-surface-2">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview simples de asset remoto (Supabase); next/image exigiria allowlist de domínio.
              <img
                src={shownLogo}
                alt="Logo da clínica"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-(length:--fs-xs) text-fg-subtle">sem logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={onPickFile}
              className="hidden"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
              </Button>
              {logoUrl ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setLogoUrl('')}>
                  Remover
                </Button>
              ) : null}
            </div>
            <span className="text-(length:--fs-xs) text-fg-subtle">
              PNG, JPG ou WEBP · mín. {MIN_LOGO_PX}×{MIN_LOGO_PX}px · até {CLINIC_LOGO_MAX_LABEL}.
            </span>
          </div>
        </div>
      </Card>

      <div>
        <Button type="button" loading={saving} onClick={save}>
          Salvar perfil
        </Button>
      </div>
    </div>
  );
}
