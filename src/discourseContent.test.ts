import { describe, expect, it } from 'vitest';

import { discourseAvatarUrl, discoursePollPlaceholder, discourseQuoteMetadata, splitDiscourseContentHtml } from './discourseContent';

describe('portable Discourse content parts', () => {
  it('[REG-XIAOYINSI-023] accepts only string HTTP(S) Discourse avatars without throwing', () => {
    const baseUrl = 'https://forum.example.com';
    const uncoercible = Object.create(null) as unknown;

    expect([
      discourseAvatarUrl('/user_avatar/example/alice/{size}/1.png', baseUrl),
      discourseAvatarUrl('//cdn.example.com/avatar.png', baseUrl),
      discourseAvatarUrl('javascript:alert(1)', baseUrl),
      discourseAvatarUrl('http://', baseUrl),
      discourseAvatarUrl({}, baseUrl),
      discourseAvatarUrl(uncoercible, baseUrl)
    ]).toEqual([
      'https://forum.example.com/user_avatar/example/alice/96/1.png',
      'https://cdn.example.com/avatar.png',
      undefined,
      undefined,
      undefined,
      undefined
    ]);
  });

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

  it('[REG-TOPIC-033] does not decode DOM attributes a second time', () => {
    const metadata = discourseQuoteMetadata(
      '<aside class="quote" data-post="2" data-display-name="Alice &amp;lt;Admin&amp;gt;"><div class="title"></div><blockquote>hi</blockquote></aside>'
    );

    expect(metadata.authors[2]).toEqual({ label: 'Alice &lt;Admin&gt;' });
  });
});
