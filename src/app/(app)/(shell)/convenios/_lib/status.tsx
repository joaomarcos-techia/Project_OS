import { Badge } from '@/components/ui/badge';
import {
  BATCH_STATUS_LABELS,
  GLOSS_STATUS_LABELS,
  GUIDE_STATUS_LABELS,
} from '@/contexts/health-insurance/queries';

type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'teal' | 'violet';

const GUIDE_TONE: Record<string, Tone> = {
  pending_data: 'amber',
  ready_for_review: 'amber',
  reviewed: 'blue',
  approved: 'teal',
  in_batch: 'violet',
  exported: 'violet',
  sent: 'blue',
  under_review: 'blue',
  paid: 'green',
  partially_paid: 'amber',
  partially_glossed: 'red',
  fully_glossed: 'red',
  closed: 'green',
  cancelled: 'gray',
  replaced: 'gray',
};

const BATCH_TONE: Record<string, Tone> = {
  prepared: 'amber',
  exported: 'violet',
  sent: 'blue',
  received: 'blue',
  under_review: 'blue',
  processed: 'green',
  cancelled: 'gray',
};

const GLOSS_TONE: Record<string, Tone> = {
  informed: 'amber',
  under_analysis: 'amber',
  contested: 'blue',
  appeal_filed: 'violet',
  reversed: 'green',
  definitive: 'red',
};

export function GuideStatusBadge({ status }: { status: string }) {
  return <Badge tone={GUIDE_TONE[status] ?? 'gray'}>{GUIDE_STATUS_LABELS[status] ?? status}</Badge>;
}

export function BatchStatusBadge({ status }: { status: string }) {
  return <Badge tone={BATCH_TONE[status] ?? 'gray'}>{BATCH_STATUS_LABELS[status] ?? status}</Badge>;
}

export function GlossStatusBadge({ status }: { status: string }) {
  return <Badge tone={GLOSS_TONE[status] ?? 'gray'}>{GLOSS_STATUS_LABELS[status] ?? status}</Badge>;
}
