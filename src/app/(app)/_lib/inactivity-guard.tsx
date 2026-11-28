'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { flushPendingWork } from './pending-work';
import type { SessionActivityResult } from './session-activity-actions';

const CHANNEL = 'qoro-session-activity';
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'scroll'];
/** Mensagens entre abas no máximo a cada 5 s (a renovação no servidor já é limitada pelo `renewThrottleMs`). */
const BROADCAST_THROTTLE_MS = 5_000;
const TICK_MS = 1_000;

type ChannelMessage = { type: 'input'; at: number } | { type: 'locked' };

export interface InactivityGuardProps {
  warnMs: number;
  limitMs: number;
  renewThrottleMs: number;
  registerActivity: () => Promise<SessionActivityResult>;
  lockSession: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Navegação depois do bloqueio (injetável para teste). */
  navigate?: (url: string) => void;
  now?: () => number;
}

/**
 * S2 / requisito 83 da ANS, no perfil de segurança TISS (o servidor só monta este guarda para quem está no alcance).
 *
 * - Interação (tecla, clique, toque, rolagem, ponteiro) renova a atividade no servidor, no máximo a cada 30 s.
 * - Abas abertas compartilham a última interação (BroadcastChannel): quem digita numa aba mantém as outras.
 * - Aos 9 min sem interação: aviso de 1 minuto e salvamento do rascunho pendente (a sessão ainda está ativa).
 * - Aos 10 min, ou quando o servidor responder que a sessão está bloqueada: a tela deixa de exibir as
 *   informações (requisito 83 b), o que estiver pendente é salvo uma última vez, a sessão é encerrada e o
 *   desbloqueio exige novo login (83 d).
 *
 * O cliente é só conveniência: a autoridade é `authenticate()`, que recusa qualquer requisição da sessão parada
 * há 10 min mesmo se este componente for removido.
 */
export function InactivityGuard({
  warnMs,
  limitMs,
  renewThrottleMs,
  registerActivity,
  lockSession,
  navigate = (url) => window.location.assign(url),
  now = () => Date.now(),
}: InactivityGuardProps) {
  const lastInput = useRef(now());
  const lastRenew = useRef(0);
  const lastBroadcast = useRef(0);
  const lockedRef = useRef(false);
  const warnedRef = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const [warning, setWarning] = useState(false);
  const [locked, setLocked] = useState(false);

  const lock = useCallback(
    async (origin: 'idle' | 'server' | 'other_tab') => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      setWarning(false);
      setLocked(true);
      if (origin !== 'other_tab')
        channel.current?.postMessage({ type: 'locked' } satisfies ChannelMessage);
      const saved = await flushPendingWork();
      try {
        await lockSession();
      } catch {
        /* a porta única já recusa a sessão; o login novo substitui o que sobrou */
      }
      navigate(`/login?reason=${saved ? 'inactivity' : 'inactivity_unsaved'}`);
    },
    [lockSession, navigate],
  );

  const renew = useCallback(
    async (force: boolean) => {
      const t = now();
      if (lockedRef.current || (!force && t - lastRenew.current < renewThrottleMs)) return;
      lastRenew.current = t;
      try {
        const res = await registerActivity();
        if (!res.ok && res.locked) void lock('server');
      } catch {
        /* rede: a próxima interação tenta de novo; o servidor bloqueia se nada chegar em 10 min */
        lastRenew.current = 0;
      }
    },
    [lock, now, registerActivity, renewThrottleMs],
  );

  const onActivity = useCallback(() => {
    if (lockedRef.current) return;
    const t = now();
    lastInput.current = t;
    warnedRef.current = false;
    setWarning(false);
    if (t - lastBroadcast.current >= BROADCAST_THROTTLE_MS) {
      lastBroadcast.current = t;
      channel.current?.postMessage({ type: 'input', at: t } satisfies ChannelMessage);
    }
    void renew(false);
  }, [now, renew]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = (e: MessageEvent<ChannelMessage>) => {
        if (e.data?.type === 'input') {
          lastInput.current = Math.max(lastInput.current, e.data.at);
          warnedRef.current = false;
          setWarning(false);
        } else if (e.data?.type === 'locked') void lock('other_tab');
      };
    }
    // Ao montar (inclusive logo depois do login): grava o registro de atividade desta sessão.
    void renew(true);
    const opts = { capture: true, passive: true } as const;
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, opts);
    const tick = setInterval(() => {
      if (lockedRef.current) return;
      const idle = now() - lastInput.current;
      if (idle >= limitMs) void lock('idle');
      else if (idle >= warnMs && !warnedRef.current) {
        warnedRef.current = true;
        setWarning(true);
        void flushPendingWork();
      }
    }, TICK_MS);
    return () => {
      clearInterval(tick);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, opts);
      channel.current?.close();
      channel.current = null;
    };
  }, [limitMs, lock, now, onActivity, renew, warnMs]);

  if (locked) {
    return (
      <div
        role="alert"
        data-session-locked
        className="fixed inset-0 z-[2147483647] grid place-items-center bg-surface p-6 text-center"
      >
        <p className="max-w-md text-sm text-fg">
          Sessão bloqueada por inatividade. Salvando o que estava pendente e encerrando; entre
          novamente para continuar.
        </p>
      </div>
    );
  }

  return (
    <Dialog open={warning} onOpenChange={(open) => (open ? null : onActivity())}>
      <DialogContent role="alertdialog" data-session-warning showClose={false}>
        <DialogHeader>
          <DialogTitle>Sua sessão será bloqueada em 1 minuto</DialogTitle>
          <DialogDescription>
            Perfil de segurança de Convênios: depois de 10 minutos sem atividade a sessão é
            bloqueada e é preciso entrar de novo. O rascunho do prontuário está sendo salvo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter>
          <Button
            onClick={() => {
              lastInput.current = now();
              warnedRef.current = false;
              setWarning(false);
              void renew(true);
            }}
          >
            Continuar trabalhando
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
