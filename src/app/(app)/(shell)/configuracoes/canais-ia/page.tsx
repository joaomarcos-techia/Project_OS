import { loadChannelStatuses } from '../settings-data';
import { SettingsCategoryPage } from '../settings-category';

export const dynamic = 'force-dynamic';

/** Única categoria que carrega estado real: a conexão do WhatsApp. */
export default async function CanaisIaSettingsPage() {
  const statuses = await loadChannelStatuses();
  return <SettingsCategoryPage id="canais-ia" statuses={statuses} />;
}
