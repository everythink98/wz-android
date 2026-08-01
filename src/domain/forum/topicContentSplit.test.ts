import { describe, expect, it, vi } from 'vitest';
import { forumVideoBlockFromHtml, splitTopicContentHtml } from './topicContentSplit';

describe('Android topic content splitting', () => {
  it('keeps nested same-name blocks together when splitting topic HTML', () => {
    const chunks = splitTopicContentHtml('<div><div>inside</div></div><p>after</p>', 1);

    expect(chunks).toEqual(['<div><div>inside</div></div>', '<p>after</p>']);
  });

  it('keeps details blocks together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const chunks = splitWithFallback('<details><summary>Step</summary><p>Body</p></details><p>after</p>', 1);

      expect(chunks).toEqual(['<details><summary>Step</summary><p>Body</p></details>', '<p>after</p>']);
    } finally {
      vi.doUnmock('./html');
    }
  });

  it('keeps iframe blocks together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const chunks = splitWithFallback(
        '<p>before</p><iframe src="https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz"></iframe><p>after</p>',
        1
      );

      expect(chunks).toEqual([
        '<p>before</p>',
        '<iframe src="https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz"></iframe>',
        '<p>after</p>'
      ]);
    } finally {
      vi.doUnmock('./html');
    }
  });

  it('keeps playable video blocks together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const chunks = splitWithFallback(
        '<p>before</p><forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video><p>after</p>',
        1
      );

      expect(chunks).toEqual([
        '<p>before</p>',
        '<forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>',
        '<p>after</p>'
      ]);
    } finally {
      vi.doUnmock('./html');
    }
  });

  it('keeps link cards together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const chunks = splitWithFallback(
        '<p>before</p><forum-link-card href="https://example.com" title="Example"></forum-link-card><p>after</p>',
        1
      );

      expect(chunks).toEqual([
        '<p>before</p>',
        '<forum-link-card href="https://example.com" title="Example"></forum-link-card>',
        '<p>after</p>'
      ]);
    } finally {
      vi.doUnmock('./html');
    }
  });

  it('keeps terminal report tabs together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const report =
        '<forum-terminal-report><forum-terminal-tab title="基本信息"><div>one</div></forum-terminal-tab><forum-terminal-tab title="回程路由"><div>two</div></forum-terminal-tab></forum-terminal-report>';
      const chunks = splitWithFallback(`<p>before</p>${report}<p>after</p>`, 1);

      expect(chunks).toEqual(['<p>before</p>', report, '<p>after</p>']);
    } finally {
      vi.doUnmock('./html');
    }
  });

  it('detects standalone playable video blocks for native rendering', () => {
    expect(forumVideoBlockFromHtml('<forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>')).toEqual({
      src: 'https://yaohuo.me/uploads/demo.mp4'
    });
  });

  it('does not treat mixed content as a standalone video block', () => {
    expect(
      forumVideoBlockFromHtml('<p>before</p><forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>')
    ).toBeNull();
  });

  it('[REG-PERF-008] skips DOM parsing when a content chunk has no native video tag', async () => {
    const parseHtml = vi.fn(() => {
      throw new Error('ordinary chunks should not be parsed for video metadata');
    });
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml
    }));
    try {
      const { forumVideoBlockFromHtml: detectVideo } = await import('./topicContentSplit');

      expect(detectVideo('<p>ordinary content</p>')).toBeNull();
      expect(parseHtml).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });
});
