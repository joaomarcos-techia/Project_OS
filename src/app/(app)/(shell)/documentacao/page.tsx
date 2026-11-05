import { permanentRedirect } from 'next/navigation';

export default function LegacyDocumentationPage() {
  permanentRedirect('/documentação');
}
