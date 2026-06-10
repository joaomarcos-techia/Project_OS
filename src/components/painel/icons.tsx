/**
 * Ícones do Painel (C-UI) — porte 1:1 de `app/icons.js` do design bundle
 * (stroke icons num grid 24, convenção do DS). + LogoIcon (4 quadrados).
 */
import type { CSSProperties } from 'react';

/* path data cru (dentro de um <svg> stroke) — verbatim do design */
const P: Record<string, string> = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  stethoscope:
    '<path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M9 17a5 5 0 0 0 10 0v-2"/><circle cx="19" cy="11" r="2.4"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M21 20a5.2 5.2 0 0 0-3.5-4.9"/>',
  record:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  docs:
    '<path d="M9 3h7l4 4v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v5h5"/><path d="M4 7v13a2 2 0 0 0 2 2h9" opacity="0.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12 7.6L3 21l1.9-6A8.4 8.4 0 1 1 21 11.5z"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2l-.4-2.6h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z"/>',
  ai: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M7 7l1.6 1.6M15.4 15.4 17 17M17 7l-1.6 1.6M8.6 15.4 7 17"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>',
  upload: '<path d="M12 21V9M8 13l4-4 4 4M5 3h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:
    '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  pill: '<path d="M10.5 20.5a4 4 0 0 1-6-5.3l8.7-8.7a4 4 0 0 1 5.7 5.7l-8.4 8.3z"/><path d="M8.5 7.5l8 8"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  building:
    '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  alert: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 9v5M12 17.5h.01"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>',
  heart: '<path d="M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
};

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 18,
  sw = 1.8,
  className,
}: {
  name: string;
  size?: number;
  sw?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[name] ?? '' }}
    />
  );
}

/** Logo de 4 quadrados (porte de logoIcon). */
export function LogoIcon({
  size = 24,
  strong = 'var(--primary-600)',
  soft = 'var(--primary-300)',
  style,
}: {
  size?: number;
  strong?: string;
  soft?: string;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={style}>
      <rect x="2.5" y="2.5" width="8.4" height="8.4" rx="2.4" fill={strong} />
      <rect x="13.1" y="2.5" width="8.4" height="8.4" rx="2.4" fill={soft} />
      <rect x="2.5" y="13.1" width="8.4" height="8.4" rx="2.4" fill={soft} />
      <rect x="13.1" y="13.1" width="8.4" height="8.4" rx="2.4" fill={strong} />
    </svg>
  );
}
