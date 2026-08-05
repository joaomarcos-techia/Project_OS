'use client';

import { useActionState, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

import { submitFeedbackAction, type SubmitFeedbackState } from './actions';

const INITIAL: SubmitFeedbackState = { error: null };

export function FeedbackForm() {
  const [state, action, pending] = useActionState(submitFeedbackAction, INITIAL);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [browser, setBrowser] = useState('');
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    setIdempotencyKey(uuidv4());
    setBrowser(navigator.userAgent.slice(0, 512));
    setPlatform((navigator.platform || 'unknown').slice(0, 256));
  }, []);
  useEffect(() => {
    if (state.success) setIdempotencyKey(uuidv4());
  }, [state.success]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="browser" value={browser} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="appVersion" value="web" />
      <Field label="Título" htmlFor="feedback-title">
        <Input
          id="feedback-title"
          name="title"
          required
          maxLength={160}
          disabled={pending}
          placeholder="Resuma sua sugestão"
        />
      </Field>
      <Field label="Descrição" htmlFor="feedback-description">
        <Textarea
          id="feedback-description"
          name="description"
          required
          minLength={10}
          maxLength={8_000}
          disabled={pending}
          placeholder="Conte o problema, a ideia ou a melhoria que faria diferença no seu dia a dia."
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoria" htmlFor="feedback-category">
          <Select id="feedback-category" name="category" defaultValue="feature" disabled={pending}>
            <option value="feature">Nova funcionalidade</option>
            <option value="improvement">Melhoria</option>
            <option value="bug">Bug</option>
            <option value="other">Outro</option>
          </Select>
        </Field>
        <Field label="Prioridade percebida" htmlFor="feedback-priority">
          <Select id="feedback-priority" name="priority" defaultValue="medium" disabled={pending}>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
          </Select>
        </Field>
      </div>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      {state.success ? (
        <Alert variant="success">
          Sugestão recebida. Obrigado por nos ajudar a evoluir o produto.
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!idempotencyKey}>
          Enviar sugestão
        </Button>
      </div>
    </form>
  );
}
