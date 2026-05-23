import { describe, expect, it } from 'vitest';
import { splitTopicContentHtml } from './topicContentSplit';

describe('Android topic content splitting', () => {
  it('keeps nested same-name blocks together when splitting topic HTML', () => {
    const chunks = splitTopicContentHtml('<div><div>inside</div></div><p>after</p>', 1);

    expect(chunks).toEqual(['<div><div>inside</div></div>', '<p>after</p>']);
  });
});
