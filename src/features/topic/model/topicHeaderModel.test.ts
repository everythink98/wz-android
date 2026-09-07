import { describe, expect, it } from 'vitest';
import { topicStatusBadges } from './topicHeaderModel';

describe('topic header model', () => {
  it('labels ended Yaohuo topics as a neutral state', () => {
    expect(topicStatusBadges({ source: 'yaohuo', closed: true })).toEqual([{ label: '已结束', tone: 'neutral' }]);
  });
  it('projects canonical topic states in display order', () => {
    expect(
      topicStatusBadges({
        solved: true,
        acceptedAnswerFloor: 3,
        pinned: true,
        closed: true,
        archived: true,
        slowModeSeconds: 120
      })
    ).toEqual([
      { label: '已解决', tone: 'success' },
      { label: '采纳 #3', tone: 'success' },
      { label: '置顶', tone: 'accent' },
      { label: '已关闭', tone: 'danger' },
      { label: '已归档', tone: 'neutral' },
      { label: '慢速 2 分钟', tone: 'warning' }
    ]);
  });
});
