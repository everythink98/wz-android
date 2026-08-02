import { describe, expect, it } from 'vitest';
import { linuxDoAiFailureState, mergeLinuxDoAiTopics } from './aiSearch';

describe('linux.do AI search model', () => {
  it('appends only new AI topics after standard results', () => {
    const standard = [
      { source: 'linuxdo' as const, id: '1', title: 'standard one', author: '', url: '', createdAt: '', replyCount: 0 },
      { source: 'linuxdo' as const, id: '2', title: 'standard two', author: '', url: '', createdAt: '', replyCount: 0 }
    ];
    const ai = [
      { ...standard[1], isAiGenerated: true },
      { ...standard[0], id: '3', title: 'AI only', isAiGenerated: true }
    ];

    expect(mergeLinuxDoAiTopics(standard, ai, true).map((topic) => topic.id)).toEqual(['1', '2', '3']);
    expect(mergeLinuxDoAiTopics(standard, ai, false)).toBe(standard);
  });

  it('separates unavailable AI search from retryable failures', () => {
    expect(linuxDoAiFailureState(Object.assign(new Error('forbidden'), { status: 403 }))).toMatchObject({
      status: 'unavailable',
      enabled: false,
      message: '当前不可用'
    });
    expect(linuxDoAiFailureState(Object.assign(new Error('limited'), { status: 429 }))).toMatchObject({
      status: 'error',
      enabled: false,
      message: 'AI 搜索失败，可重试'
    });
  });
});
