'use client';

/**
 * P2.5 — conexão com a operadora. Hoje o envio é o arquivo XML validado no XSD, que a clínica
 * envia no portal da operadora. As credenciais do webservice podem ser guardadas (cifradas,
 * nunca exibidas), mas o envio automático só existe depois da homologação com cada operadora.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import {
  revokeInsurerCredentialAction,
  saveInsurerCredentialAction,
} from '@/contexts/health-insurance/config-actions';
import type { InsurerCredentialView } from '@/contexts/health-insurance/config-queries';

const KIND_LABEL = {
  webservice_login: 'Login do webservice',
  certificate: 'Certificado digital',
} as const;
const day = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export function InsurerConnectionPanel({
  insurerId,
  credentials,
  editable,
}: {
  insurerId: string;
  credentials: InsurerCredentialView[];
  editable: boolean;
}) {
  const router = useRouter();
  const kindId = useId();
  const userId = useId();
  const secretId = useId();
  const [kind, setKind] = useState<'webservice_login' | 'certificate'>('webservice_login');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = credentials.filter((c) => c.status === 'active');

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveInsurerCredentialAction({
        insurerId,
        kind,
        username: username || null,
        secret,
      });
      setSecret('');
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(
        r.data.rotated ? 'Credencial trocada' : 'Credencial guardada',
        'Cifrada; nunca é exibida.',
      );
      setUsername('');
      router.refresh();
    });
  };
  const revoke = (credentialId: string) => {
    setError(null);
    startTransition(async () => {
      const r = await revokeInsurerCredentialAction({ insurerId, credentialId });
      if (!r.ok) setError(r.error);
      else toast.success('Credencial revogada');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-(--sp-3)" data-testid="insurer-connection">
      <p className="text-(length:--fs-sm)" data-testid="insurer-connection-mode">
        <strong>Envio hoje:</strong> arquivo XML do lote, validado no XSD oficial, baixado no Qoro e
        enviado pela clínica no portal da operadora.
      </p>
      <Alert variant="info" title="Envio automático por webservice">
        Depende do contrato e da homologação com esta operadora (endereço, versão TISS e certificado
        são dela). Guardar a credencial aqui não envia nada: até a homologação, o Qoro não transmite
        guias para a operadora.
      </Alert>
      {credentials.length ? (
        <ul className="flex flex-col gap-1 text-(length:--fs-sm)">
          {credentials.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2"
              data-testid="insurer-credential"
              data-status={c.status}
            >
              <Badge tone={c.status === 'active' ? 'green' : 'gray'}>
                {c.status === 'active' ? 'Ativa' : 'Revogada'}
              </Badge>
              <span>{KIND_LABEL[c.kind]}</span>
              <span className="text-fg-muted">
                guardada em {day(c.createdAt)}
                {c.rotatedAt ? ` · revogada em ${day(c.rotatedAt)}` : ''} · nunca usada para envio
              </span>
              {editable && c.status === 'active' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => revoke(c.id)}
                  disabled={pending}
                >
                  Revogar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma credencial guardada.</p>
      )}
      {editable ? (
        <div className="grid gap-(--sp-2) sm:grid-cols-3">
          <Field label="Tipo" htmlFor={kindId}>
            <Select
              id={kindId}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value === 'certificate' ? 'certificate' : 'webservice_login')
              }
            >
              <option value="webservice_login">Login do webservice</option>
              <option value="certificate">Certificado digital</option>
            </Select>
          </Field>
          {kind === 'webservice_login' ? (
            <Field label="Usuário na operadora" htmlFor={userId}>
              <Input
                id={userId}
                value={username}
                autoComplete="off"
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
          ) : null}
          <Field
            label={kind === 'certificate' ? 'Certificado (conteúdo)' : 'Senha'}
            htmlFor={secretId}
          >
            <Input
              id={secretId}
              type="password"
              value={secret}
              autoComplete="new-password"
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-3">
            <Button
              type="button"
              onClick={save}
              disabled={pending || secret.length < 8}
              data-testid="insurer-credential-save"
            >
              {active.some((c) => c.kind === kind) ? 'Trocar credencial' : 'Guardar credencial'}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}
