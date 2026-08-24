import { loadGestaoStatuses } from '../settings-data';
import { SettingsCategoryPage } from '../settings-category';

export const dynamic = 'force-dynamic';

export default async function GestaoSettingsPage() {
  const statuses = await loadGestaoStatuses();
  return <SettingsCategoryPage id="gestao" statuses={statuses} />;
}
