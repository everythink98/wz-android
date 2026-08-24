import { describe, expect, it } from 'vitest';
import { parseForumTopicDestination, parseInternalTopicOpenLink } from './links';

describe('forum links', () => {
  it('[REG-NOTIFY-045] keeps the exact Yaohuo full-reply floor from the original link', () => {
    expect(
      parseForumTopicDestination(
        'https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=1560939&tofloor=90&fromuserid=1000'
      )?.targetReply
    ).toEqual({ floor: 90 });
    expect(
      parseForumTopicDestination('https://www.yaohuo.me/bbs/book_re.aspx?id=1&tofloor=0')?.targetReply
    ).toBeUndefined();
    expect(
      parseForumTopicDestination('https://www.yaohuo.me/bbs/book_re.aspx?id=1&tofloor=1.5')?.targetReply
    ).toBeUndefined();
    expect(parseForumTopicDestination('https://www.yaohuo.me/bbs-1.html?tofloor=90')?.targetReply).toBeUndefined();
    expect(parseForumTopicDestination('https://evil.example/bbs/book_re.aspx?id=1&tofloor=90')).toBeNull();
  });

  it('[REG-TOPIC-062] preserves native topic anchors for all four sources', () => {
    expect(parseForumTopicDestination('https://www.nodeseek.com/post-123-16#155')).toMatchObject({
      topic: { source: 'nodeseek', id: '123' },
      targetReply: { floor: 155, pageHint: 16 }
    });
    expect(parseForumTopicDestination('https://linux.do/t/topic/456/90')).toMatchObject({
      topic: { source: 'linuxdo', id: '456' },
      targetReply: { floor: 90 }
    });
    expect(parseForumTopicDestination('https://linux.do/t/topic/456/90')).toMatchObject({
      topic: { source: 'linuxdo', id: '456' },
      targetReply: { floor: 90 }
    });
    expect(
      parseForumTopicDestination('https://www.yaohuo.me/bbs/book_re.aspx?id=321&classid=177&tofloor=90')
    ).toMatchObject({
      topic: { source: 'yaohuo', id: '321' },
      targetReply: { floor: 90 }
    });
    expect(parseForumTopicDestination('https://www.v2ex.com/t/789#reply12')).toMatchObject({
      topic: { source: 'v2ex', id: '789' },
      targetReply: { floor: 12 }
    });
  });

  it.each([
    [
      'NodeSeek',
      'https://www.nodeseek.com/post-123-16#155',
      { source: 'nodeseek', id: '123' },
      { floor: 155, pageHint: 16 }
    ],
    ['linux.do', 'https://linux.do/t/topic/456/90', { source: 'linuxdo', id: '456' }, { floor: 90 }],
    ['V2EX', 'https://www.v2ex.com/t/789#reply12', { source: 'v2ex', id: '789' }, { floor: 12 }],
    [
      '妖火',
      'https://www.yaohuo.me/bbs/book_re.aspx?id=321&classid=177&tofloor=90',
      { source: 'yaohuo', id: '321' },
      { floor: 90 }
    ]
  ])(
    '[REG-NAV-003] preserves the complete %s destination through the internal Topic link',
    (_, url, topic, targetReply) => {
      const deepLink = `exp+wz-android://open-topic?url=${encodeURIComponent(url)}`;

      expect(parseInternalTopicOpenLink(deepLink)).toMatchObject({ topic, targetReply });
    }
  );
});
