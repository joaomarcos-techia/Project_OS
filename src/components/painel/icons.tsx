/**
 * Camada de compatibilidade de ícones — ADR-031: lucide-react é o sistema
 * único. Os nomes históricos do design bundle são mapeados para lucide;
 * código NOVO deve importar de 'lucide-react' direto. Este arquivo é
 * inlinado/deletado na limpeza final da refatoração (Onda 7).
 */
import {
  Banknote,
  Bell,
  Building2,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  Clock,
  Download,
  Ellipsis,
  Eye,
  File,
  Files,
  FileText,
  FlaskConical,
  Funnel,
  Heart,
  LayoutGrid,
  Lock,
  MessageCircle,
  Monitor,
  Package,
  PenLine,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid,
  calendar: Calendar,
  stethoscope: Stethoscope,
  users: Users,
  record: FileText,
  docs: Files,
  wallet: Wallet,
  chat: MessageCircle,
  chart: ChartColumn,
  shield: ShieldCheck,
  gear: Settings,
  ai: Sparkles,
  search: Search,
  plus: Plus,
  chevR: ChevronRight,
  chevD: ChevronDown,
  bell: Bell,
  filter: Funnel,
  download: Download,
  upload: Upload,
  clock: Clock,
  check: Check,
  x: X,
  dots: Ellipsis,
  eye: Eye,
  edit: PenLine,
  trash: Trash2,
  pill: Pill,
  flask: FlaskConical,
  file: File,
  box: Package,
  cash: Banknote,
  lock: Lock,
  monitor: Monitor,
  building: Building2,
  alert: TriangleAlert,
  refresh: RefreshCw,
  heart: Heart,
  send: Send,
  help: CircleQuestionMark,
};

export type IconName = keyof typeof ICONS;

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
  const LucideCmp = ICONS[name];
  if (!LucideCmp) return null;
  return <LucideCmp size={size} strokeWidth={sw} className={className} aria-hidden="true" />;
}

/** Logo de 4 quadrados (marca ClinicaOS — não é lucide). */
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      <rect x="2.5" y="2.5" width="8.4" height="8.4" rx="2.4" fill={strong} />
      <rect x="13.1" y="2.5" width="8.4" height="8.4" rx="2.4" fill={soft} />
      <rect x="2.5" y="13.1" width="8.4" height="8.4" rx="2.4" fill={soft} />
      <rect x="13.1" y="13.1" width="8.4" height="8.4" rx="2.4" fill={strong} />
    </svg>
  );
}
