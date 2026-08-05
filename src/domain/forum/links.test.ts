import { describe, expect, it } from 'vitest';
import { parseForumTopicDestination, parseForumTopicReplyTarget } from './links';

describe('forum links', () => {
  it('[REG-NOTIFY-045] keeps the exact Yaohuo full-reply floor from the original link', () => {
    expect(
      parseForumTopicReplyTarget(
        'https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=1560939&tofloor=90&fromuserid=1000'
      )
    ).toEqual({ floor: 90 });
    expect(parseForumTopicReplyTarget('https://www.yaohuo.me/bbs/book_re.aspx?id=1&tofloor=0')).toBeUndefined();
    expect(parseForumTopicReplyTarget('https://www.yaohuo.me/bbs/book_re.aspx?id=1&tofloor=1.5')).toBeUndefined();
    expect(parseForumTopicReplyTarget('https://www.yaohuo.me/bbs-1.html?tofloor=90')).toBeUndefined();
    expect(parseForumTopicReplyTarget('https://evil.example/bbs/book_re.aspx?id=1&tofloor=90')).toBeUndefined();
  });

  it('[REG-TOPIC-062] preserves native topic anchors for all five sources', () => {
    expect(parseForumTopicDestination('https://www.nodeseek.com/post-123-16#155')).toMatchObject({
      topic: { source: 'nodeseek', id: '123' },
      targetReply: { floor: 155, pageHint: 16 }
    });
    expect(parseForumTopicDestination('https://linux.do/t/topic/456/90')).toMatchObject({
      topic: { source: 'linuxdo', id: '456' },
      targetReply: { floor: 90 }
    });
    expect(parseForumTopicDestination('https://forum.xiaoyinsi.com/t/topic/456/90')).toMatchObject({
      topic: { source: 'xiaoyinsi', id: '456' },
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
});
