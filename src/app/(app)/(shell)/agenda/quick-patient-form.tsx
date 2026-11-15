'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { uuidv4 } from '@/lib/ui/uuid';

import { criarPacienteRapido, type QuickPatientResult } from './quick-patient-actions';

type Campo = 'nome' | 'cpf' | 'telefone';
const ORDEM: readonly Campo[] = ['nome', 'cpf', 'telefone'];

/**
 * UX-006 — cadastro rápido dentro do novo agendamento. Não é um `<form>`: fica
 * dentro do formulário do agendamento (formulário aninhado é HTML inválido), então
 * Enter nos campos daqui salva o paciente em vez de enviar o agendamento.
 */
export function QuickPatientForm({
  onCreated,
  onCancel,
}: {
  onCreated: (patient: { id: string; label: string }) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const ids: Record<Campo, string> = {
    nome: `${baseId}-nome`,
    cpf: `${baseId}-cpf`,
    telefone: `${baseId}-telefone`,
  };
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Uma chave por abertura: clique duplo ou nova tentativa devolvem o mesmo paciente.
  const chave = useRef<string>(uuidv4());

  function focarPrimeiro(lista: Partial<Record<Campo, string>>) {
    const primeiro = ORDEM.find((campo) => lista[campo]);
    if (primeiro) requestAnimationFrame(() => document.getElementById(ids[primeiro])?.focus());
  }

  async function salvar() {
    if (salvando) return;
    setMensagem(null);
    const locais: Partial<Record<Campo, string>> = {};
    if (!nome.trim()) locais.nome = 'Informe o nome do paciente.';
    if (cpf.replace(/\D/g, '').length !== 11) locais.cpf = 'Informe o CPF com 11 dígitos.';
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      focarPrimeiro(locais);
      return;
    }
    setErros({});
    setSalvando(true);
    let res: QuickPatientResult;
    try {
      res = await criarPacienteRapido({ nome, cpf, telefone, idempotencyKey: chave.current });
    } catch {
      setSalvando(false);
      setMensagem(
        'Não conseguimos confirmar o cadastro. Tente de novo: se ele já tiver sido salvo, o mesmo paciente será usado.',
      );
      return;
    }
    setSalvando(false);
    if (res.ok) {
      onCreated({ id: res.id, label: res.nome });
      return;
    }
    setErros(res.fieldErrors);
    setMensagem(res.message);
    focarPrimeiro(res.fieldErrors);
  }

  function enterSalva(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void salvar();
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${baseId}-titulo`}
      className="flex flex-col gap-3 rounded-(--r-lg) border border-border p-(--sp-4)"
    >
      <p id={`${baseId}-titulo`} className="text-(length:--fs-sm) font-semibold">
        Novo paciente
      </p>
      {mensagem ? <Alert variant="danger">{mensagem}</Alert> : null}
      <Field label="Nome" htmlFor={ids.nome} error={erros.nome} required>
        <Input
          id={ids.nome}
          value={nome}
          autoComplete="off"
          maxLength={120}
          invalid={Boolean(erros.nome)}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={enterSalva}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CPF" htmlFor={ids.cpf} error={erros.cpf} required>
          <Input
            id={ids.cpf}
            value={cpf}
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            invalid={Boolean(erros.cpf)}
            onChange={(e) => setCpf(e.target.value)}
            onKeyDown={enterSalva}
          />
        </Field>
        <Field
          label="Telefone (opcional)"
          htmlFor={ids.telefone}
          error={erros.telefone}
          hint="Com DDD. É por ele que a clínica fala com o paciente no WhatsApp."
        >
          <Input
            id={ids.telefone}
            type="tel"
            value={telefone}
            inputMode="tel"
            autoComplete="off"
            maxLength={20}
            invalid={Boolean(erros.telefone)}
            onChange={(e) => setTelefone(e.target.value)}
            onKeyDown={enterSalva}
          />
        </Field>
      </div>
      <p className="text-(length:--fs-xs) text-fg-muted">
        Endereço, e-mail e responsável podem ser completados depois na ficha do paciente.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={salvando} onClick={() => void salvar()}>
          Cadastrar e selecionar
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={salvando} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
