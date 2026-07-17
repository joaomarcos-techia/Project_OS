'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ChangeEvent } from 'react';

import { updateClinicProfile, uploadClinicLogo } from '@/contexts/tenancy/actions';
import type { ClinicProfile } from '@/contexts/tenancy/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB (espelha CLINIC_LOGO_MAX_BYTES)
const MAX_LOGO_LABEL = '5 MB';
const ACCEPT = 'image/png,image/jpeg,image/webp';

export function PerfilForm({ initial }: { initial: ClinicProfile }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(initial.nome);
  const [endereco, setEndereco] = useState(initial.endereco ?? '');
  const [telefone, setTelefone] = useState(initial.telefone ?? '');
  const [cnpj, setCnpj] = useState(initial.cnpj ?? '');
  const [cnes, setCnes] = useState(initial.cnes ?? '');
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '');
  const [saving, startSave] = useTransition();
  const [uploading, startUpload] = useTransition();

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      return toast.error('Formato inválido. Use PNG, JPG ou WEBP.');
    }
    if (file.size > MAX_LOGO_BYTES) {
      return toast.error(`Imagem muito grande (máx. ${MAX_LOGO_LABEL}).`);
    }
    const fd = new FormData();
    fd.append('file', file);
    startUpload(async () => {
      const res = await uploadClinicLogo(fd);
      if (res.ok) {
        setLogoUrl(res.url);
        toast.success('Logo enviado. Clique em “Salvar perfil” para aplicar.');
      } else {
        toast.error(res.message);
      }
    });
  }

  function save() {
    if (!nome.trim()) return toast.error('Informe o nome da clínica.');
    startSave(async () => {
      const res = await updateClinicProfile({
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
    <div className="stack" style={{ maxWidth: 560 }}>

      {/* Dados do documento */}
      <div className="cardblock wrap-pad flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Dados da clínica (aparecem nos documentos)</h4>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">Nome *</span>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted">Endereço</span>
          <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={240} />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">Telefone</span>
            <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={40} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">CNPJ</span>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} maxLength={20} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-muted">CNES</span>
            <Input value={cnes} onChange={(e) => setCnes(e.target.value)} maxLength={20} />
          </label>
        </div>
      </div>

      {/* Logo do receituário */}
      <div className="cardblock wrap-pad flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Logo no receituário</h4>
        <div className="flex items-center gap-3">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded border border-border bg-surface-subtle">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview simples de asset remoto (Supabase); next/image exigiria allowlist de domínio.
              <img src={logoUrl} alt="Logo da clínica" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-fg-subtle">sem logo</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={onPickFile} className="hidden" />
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
            <span className="text-xs text-fg-subtle">PNG, JPG ou WEBP, até {MAX_LOGO_LABEL}.</span>
          </div>
        </div>
      </div>

      <div>
        <Button type="button" size="sm" loading={saving} onClick={save}>
          Salvar perfil
        </Button>
      </div>
    </div>
  );
}
