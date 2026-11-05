import { notFound, permanentRedirect } from 'next/navigation';
import { findDocTopic } from '../content';

export default async function LegacyDocumentationTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const topic = findDocTopic((await params).topic);
  if (!topic) notFound();
  permanentRedirect(`/documentação/${topic.slug}`);
}
