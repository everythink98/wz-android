import type { Topic, TopicDetail } from '@/domain/forum/models';

function slowModeLabel(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

export function topicStatusBadges(
  item: Pick<Topic, 'acceptedAnswerFloor' | 'archived' | 'closed' | 'pinned' | 'slowModeSeconds' | 'solved'>
) {
  const badges: { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' | 'warning' }[] = [];
  if (item.solved) badges.push({ label: '已解决', tone: 'success' });
  if (item.acceptedAnswerFloor) badges.push({ label: `采纳 #${item.acceptedAnswerFloor}`, tone: 'success' });
  if (item.pinned) badges.push({ label: '置顶', tone: 'accent' });
  if (item.closed) badges.push({ label: '已关闭', tone: 'danger' });
  if (item.archived) badges.push({ label: '已归档', tone: 'neutral' });
  if (item.slowModeSeconds) {
    badges.push({ label: `慢速 ${slowModeLabel(item.slowModeSeconds)}`, tone: 'warning' });
  }
  return badges;
}

export function readableTopicError(message: string) {
  if (/upstream unavailable/i.test(message)) return '来源暂时不可用，请稍后重试';
  if (/^HTTP 5\d\d$/i.test(message)) return `来源暂时不可用（${message}）`;
  return message;
}

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
