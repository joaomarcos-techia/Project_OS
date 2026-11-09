'use client';

import type { ReactElement, ReactNode } from 'react';
import UseAnimations, { type Animation, type EventProps } from 'react-useanimations';
import barChart from 'react-useanimations/lib/barChart';
import calendar from 'react-useanimations/lib/calendar';
import creditCard from 'react-useanimations/lib/creditCard';
import dollarSign from 'react-useanimations/lib/dollarSign';
import fileText from 'react-useanimations/lib/fileText';
import help from 'react-useanimations/lib/help';
import home from 'react-useanimations/lib/home';
import logOut from 'react-useanimations/lib/logOut';
import messageCircle from 'react-useanimations/lib/messageCircle';
import monitor from 'react-useanimations/lib/monitor';
import moon from 'react-useanimations/lib/moon';
import settings from 'react-useanimations/lib/settings';
import shield from 'react-useanimations/lib/shield';
import sidebar from 'react-useanimations/lib/sidebar';
import sun from 'react-useanimations/lib/sun';
import users from 'react-useanimations/lib/users';

/**
 * Ícones animados do menu lateral (useAnimations, licença MIT). As chaves são os
 * nomes de `MODULES`, mais os do rodapé. Sem chave aqui o ícone segue estático,
 * com a microanimação em CSS: a biblioteca não tem estetoscópio.
 */
const RAIL_ANIMATIONS: Record<string, Animation> = {
  home,
  calendar,
  users,
  record: fileText,
  wallet: creditCard,
  cash: dollarSign,
  chat: messageCircle,
  chart: barChart,
  shield,
  gear: settings,
  help,
  pin: sidebar,
  light: sun,
  dark: moon,
  system: monitor,
  logout: logOut,
};

/**
 * Liga a animação ao item inteiro, não só ao desenho: passar o mouse ou focar o
 * link toca o ícone. O `fallback` estático fica até a biblioteca desenhar, para
 * o menu não aparecer sem ícones antes da hidratação.
 */
export function RailAnimated({
  name,
  size,
  fallback,
  children,
}: {
  name: string;
  size: number;
  fallback: ReactNode;
  children: (icon: ReactNode, events?: EventProps) => ReactElement;
}) {
  const animation = RAIL_ANIMATIONS[name];
  if (!animation) return children(fallback);
  return (
    <UseAnimations
      animation={animation}
      interaction="hover"
      size={size}
      render={(events, props) =>
        children(
          <>
            <span {...props} />
            {fallback}
          </>,
          events,
        )
      }
    />
  );
}
