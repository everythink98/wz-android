import type { Topic } from '@/domain/forum/models';

function slowModeLabel(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

export function topicStatusBadges(
  item: Pick<Topic, 'acceptedAnswerFloor' | 'archived' | 'closed' | 'pinned' | 'slowModeSeconds' | 'solved'> &
    Partial<Pick<Topic, 'source'>>
) {
  const badges: { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' | 'warning' }[] = [];
  if (item.solved) badges.push({ label: '已解决', tone: 'success' });
  if (item.acceptedAnswerFloor) badges.push({ label: `采纳 #${item.acceptedAnswerFloor}`, tone: 'success' });
  if (item.pinned) badges.push({ label: '置顶', tone: 'accent' });
  if (item.closed)
    badges.push(item.source === 'yaohuo' ? { label: '已结束', tone: 'neutral' } : { label: '已关闭', tone: 'danger' });
  if (item.archived) badges.push({ label: '已归档', tone: 'neutral' });
  if (item.slowModeSeconds) {
    badges.push({ label: `慢速 ${slowModeLabel(item.slowModeSeconds)}`, tone: 'warning' });
  }
  return badges;
}
