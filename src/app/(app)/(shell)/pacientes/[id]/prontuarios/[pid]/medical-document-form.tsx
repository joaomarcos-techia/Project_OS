'use client';

import { useActionState, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { createMedicalDocumentForm, type FormState } from '../actions';

const INITIAL: FormState = { error: null };

type DocType = 'atestado' | 'declaracao' | 'exame' | 'encaminhamento';

const TYPE_LABEL: Record<DocType, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  exame: 'Solicitação de exames',
  encaminhamento: 'Encaminhamento',
};

export function MedicalDocumentForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(createMedicalDocumentForm, INITIAL);
  const key = useMemo(() => crypto.randomUUID(), []);
  const [type, setType] = useState<DocType>('atestado');

  // campos genéricos (só os relevantes ao tipo são usados ao montar o content)
  const [descricao, setDescricao] = useState('');
  const [cid, setCid] = useState('');
  const [dias, setDias] = useState('');
  const [texto, setTexto] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [exames, setExames] = useState('');
  const [indicacao, setIndicacao] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [motivo, setMotivo] = useState('');

  const content = useMemo<Record<string, unknown>>(() => {
    switch (type) {
      case 'atestado':
        return {
          descricao: descricao.trim(),
          ...(cid.trim() ? { cid: cid.trim() } : {}),
          ...(dias.trim() ? { dias: Number(dias) } : {}),
        };
      case 'declaracao':
        return { texto: texto.trim(), ...(periodo.trim() ? { periodo: periodo.trim() } : {}) };
      case 'exame':
        return {
          exames: exames
            .split('\n')
            .map((e) => e.trim())
            .filter(Boolean),
          ...(indicacao.trim() ? { indicacaoClinica: indicacao.trim() } : {}),
        };
      case 'encaminhamento':
        return { especialidade: especialidade.trim(), motivo: motivo.trim() };
    }
  }, [type, descricao, cid, dias, texto, periodo, exames, indicacao, especialidade, motivo]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="content" value={JSON.stringify(content)} />

      <Select
        value={type}
        onChange={(e) => setType(e.target.value as DocType)}
        className="max-w-xs"
      >
        {(Object.keys(TYPE_LABEL) as DocType[]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </Select>

      {type === 'atestado' ? (
        <>
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (ex.: necessitou comparecer a consulta médica nesta data)"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="CID (opcional)"
            />
            <Input
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              placeholder="Dias de afastamento (opcional)"
              inputMode="numeric"
            />
          </div>
        </>
      ) : null}

      {type === 'declaracao' ? (
        <>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Texto da declaração"
            rows={2}
          />
          <Input
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            placeholder="Período (opcional)"
          />
        </>
      ) : null}

      {type === 'exame' ? (
        <>
          <Textarea
            value={exames}
            onChange={(e) => setExames(e.target.value)}
            placeholder="Exames (um por linha)"
            rows={3}
          />
          <Input
            value={indicacao}
            onChange={(e) => setIndicacao(e.target.value)}
            placeholder="Indicação clínica (opcional)"
          />
        </>
      ) : null}

      {type === 'encaminhamento' ? (
        <>
          <Input
            value={especialidade}
            onChange={(e) => setEspecialidade(e.target.value)}
            placeholder="Especialidade de destino"
          />
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo do encaminhamento"
            rows={2}
          />
        </>
      ) : null}

      <Button type="submit" className="self-start" loading={pending}>
        Emitir documento (PDF)
      </Button>
      {state.error ? <p className="text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
