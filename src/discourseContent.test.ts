import { describe, expect, it } from 'vitest';

import { discoursePollPlaceholder, splitDiscourseContentHtml } from './discourseContent';

describe('portable Discourse content parts', () => {
  it('keeps embedded poll order and appends polls missing from markup', () => {
    const first = { name: 'first', options: [{ id: 'a', label: 'A' }] };
    const second = { name: 'second', options: [{ id: 'b', label: 'B' }] };
    const html = `<p>before</p>${discoursePollPlaceholder('first')}<p>after</p>`;

    expect(splitDiscourseContentHtml(html, [first, second]).map((part) => part.type === 'poll'
      ? `poll:${part.poll.name}`
      : part.html
    )).toEqual(['<p>before</p>', 'poll:first', '<p>after</p>', 'poll:second']);
  });

  it('escapes poll names used in placeholder attributes', () => {
    expect(discoursePollPlaceholder('a"<&')).toContain('name="a&quot;&lt;&amp;"');
  });
});
