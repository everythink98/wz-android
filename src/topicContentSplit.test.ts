import { describe, expect, it, vi } from 'vitest';
import { splitTopicContentHtml } from './topicContentSplit';

describe('Android topic content splitting', () => {
  it('keeps nested same-name blocks together when splitting topic HTML', () => {
    const chunks = splitTopicContentHtml('<div><div>inside</div></div><p>after</p>', 1);

    expect(chunks).toEqual(['<div><div>inside</div></div>', '<p>after</p>']);
  });

  it('keeps details blocks together when the parser fallback splits topic HTML', async () => {
    vi.resetModules();
    vi.doMock('./localHtml', () => ({
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { splitTopicContentHtml: splitWithFallback } = await import('./topicContentSplit');
      const chunks = splitWithFallback('<details><summary>Step</summary><p>Body</p></details><p>after</p>', 1);

      expect(chunks).toEqual(['<details><summary>Step</summary><p>Body</p></details>', '<p>after</p>']);
    } finally {
      vi.doUnmock('./localHtml');
    }
  });
});
