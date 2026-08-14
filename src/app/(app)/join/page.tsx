import { JoinEntry } from './join-entry';

export const dynamic = 'force-dynamic';

/** O token vive no fragmento e, portanto, não chega nesta renderização inicial. */
export default function JoinPage() {
  return <JoinEntry />;
}
