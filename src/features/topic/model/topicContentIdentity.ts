import type { TopicDetail } from '@/domain/forum/models';

export function hasSameYaohuoTopicLayout(previous: TopicDetail | null, current: TopicDetail | null) {
  if (
    !previous ||
    !current ||
    previous.source !== 'yaohuo' ||
    current.source !== 'yaohuo' ||
    previous.id !== current.id
  ) {
    return false;
  }
  const previousRecord = previous as unknown as Record<string, unknown>;
  const currentRecord = current as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(currentRecord)]);
  for (const key of keys) {
    if (key === 'bookmarked' || key === 'bookmarkId') continue;
    if (!Object.is(previousRecord[key], currentRecord[key])) return false;
  }
  return true;
}
