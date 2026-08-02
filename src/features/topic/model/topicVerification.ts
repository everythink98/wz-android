import type { Topic, TopicDetail } from '@/domain/forum/models';

export async function verifyLinuxDoTopic({
  identityPending,
  refreshTopic,
  selectedTopic,
  showVerification,
  topicDetail
}: {
  identityPending: boolean;
  refreshTopic: (topic: Topic) => Promise<unknown>;
  selectedTopic: Topic | null;
  showVerification: () => Promise<unknown>;
  topicDetail: TopicDetail | null;
}) {
  const topic = topicDetail || selectedTopic;
  if (topic?.source === 'linuxdo' && !identityPending) {
    await refreshTopic(topic);
    return 'refreshed' as const;
  }
  await showVerification();
  return 'verification' as const;
}
