import { HTMLElement } from 'node-html-parser';
import { describe, expect, it, vi } from 'vitest';

import {
  discourseAvatarUrl,
  discoursePollPlaceholder,
  discourseQuoteMetadata,
  splitDiscourseContentHtml,
  stripDiscourseCalloutMarkersFromExcerpt
} from './content';
import { sanitizeLinuxDoContentHtml } from '@/sources/linuxdo/parser';

describe('portable Discourse content parts', () => {
  it('[REG-TOPIC-056] renders a leading warning marker as semantic Callout content', () => {
    const html = sanitizeLinuxDoContentHtml('<blockquote><p>[!warning] 注意！！<br>正文</p></blockquote>', []);

    expect(html).not.toContain('[!warning]');
    expect(html).toContain('data-forum-callout="true"');
    expect(html).toContain('data-forum-callout-type="warning"');
    expect(html).toContain('<div class="forum-callout-title forum-callout-tone-warning">注意！！</div>');
    expect(html).toContain('<div class="forum-callout-content"><p>正文</p></div>');
  });

  it('[REG-TOPIC-056] normalizes Callouts in the existing DOM without reparsing fragments', () => {
    const innerHtmlSetter = vi.spyOn(HTMLElement.prototype, 'innerHTML', 'set');
    const clone = vi.spyOn(HTMLElement.prototype, 'clone');
    try {
      sanitizeLinuxDoContentHtml('<blockquote><p><strong>[!warning] Title<br>Body</strong></p></blockquote>', []);

      expect(innerHtmlSetter).not.toHaveBeenCalled();
      expect(clone).not.toHaveBeenCalled();
    } finally {
      innerHtmlSetter.mockRestore();
      clone.mockRestore();
    }
  });

  it.each([
    ['note', 'note', 'Note'],
    ['abstract', 'abstract', 'Abstract'],
    ['summary', 'abstract', 'Summary'],
    ['tldr', 'abstract', 'TLDR'],
    ['info', 'info', 'Info'],
    ['todo', 'todo', 'Todo'],
    ['tip', 'tip', 'Tip'],
    ['hint', 'tip', 'Hint'],
    ['important', 'tip', 'Important'],
    ['success', 'success', 'Success'],
    ['check', 'success', 'Check'],
    ['done', 'success', 'Done'],
    ['question', 'question', 'Question'],
    ['help', 'question', 'Help'],
    ['faq', 'question', 'FAQ'],
    ['warning', 'warning', 'Warning'],
    ['caution', 'warning', 'Caution'],
    ['attention', 'warning', 'Attention'],
    ['failure', 'failure', 'Failure'],
    ['fail', 'failure', 'Fail'],
    ['missing', 'failure', 'Missing'],
    ['danger', 'danger', 'Danger'],
    ['error', 'danger', 'Error'],
    ['bug', 'bug', 'Bug'],
    ['example', 'example', 'Example'],
    ['quote', 'quote', 'Quote'],
    ['cite', 'quote', 'Cite']
  ])('[REG-TOPIC-056] maps %s to %s with its own default title', (marker, type, title) => {
    const html = sanitizeLinuxDoContentHtml(`<blockquote><p>[!${marker}]<br>Body</p></blockquote>`, []);

    expect(html).toContain(`data-forum-callout-type="${type}"`);
    expect(html).toContain(`<div class="forum-callout-title forum-callout-tone-`);
    expect(html).toContain(`">${title}</div>`);
  });

  it('[REG-TOPIC-056] handles case, unknown fallback, rich titles, empty bodies and fold defaults', () => {
    const html = sanitizeLinuxDoContentHtml(
      [
        '<blockquote><p><strong>[!CaUtIoN] <em>请先</em></strong> <a href="/rules">阅读规则</a><br>正文</p></blockquote>',
        '<blockquote><p>[!custom]- 自定义标题<br><code>折叠正文</code></p></blockquote>',
        '<blockquote><p>[!__proto__]<br>Prototype key</p></blockquote>',
        '<blockquote><p>[!constructor]<br>Constructor key</p></blockquote>',
        '<blockquote><p>[!tip]+</p></blockquote>'
      ].join(''),
      []
    );

    expect(html).not.toContain('[!');
    expect(html).toContain('data-forum-callout-type="warning"');
    expect(html).toContain(
      '<div class="forum-callout-title forum-callout-tone-warning"><strong><em>请先</em></strong> <a href="https://linux.do/rules">阅读规则</a></div>'
    );
    expect(html).toContain('data-forum-callout-type="note" data-forum-callout-fold="collapsed"');
    expect(html).toContain('<div class="forum-callout-title forum-callout-tone-primary">自定义标题</div>');
    expect(html).toContain('<div class="forum-callout-content"><p><code>折叠正文</code></p></div>');
    expect(html.match(/data-forum-callout-type="note"/g)).toHaveLength(3);
    expect(html).toContain(
      '<div class="forum-callout-title forum-callout-tone-primary">Note</div><div class="forum-callout-content"><p>Prototype key</p></div>'
    );
    expect(html).toContain(
      '<div class="forum-callout-title forum-callout-tone-primary">Note</div><div class="forum-callout-content"><p>Constructor key</p></div>'
    );
    expect(html).toContain('data-forum-callout-type="tip" data-forum-callout-fold="expanded"');
    expect(html).toContain('<div class="forum-callout-title forum-callout-tone-primary">Tip</div></blockquote>');
  });

  it('[REG-TOPIC-056] skips empty inline nodes before the first effective marker text', () => {
    const html = sanitizeLinuxDoContentHtml(
      '<blockquote><p><span></span>[!warning] Title<br>Body</p></blockquote>',
      []
    );

    expect(html).not.toContain('[!warning]');
    expect(html).toContain('data-forum-callout-type="warning"');
    expect(html).toContain('<div class="forum-callout-title forum-callout-tone-warning">Title</div>');
  });

  it('[REG-TOPIC-056] recognizes an entity-encoded leading marker as DOM text', () => {
    const html = sanitizeLinuxDoContentHtml(
      '<blockquote><p>&#91;!warning&#93; Encoded title<br>Body</p></blockquote>',
      []
    );

    expect(html).not.toContain('[!warning]');
    expect(html).not.toContain('&#91;!warning&#93;');
    expect(html).toContain('data-forum-callout-type="warning"');
  });

  it('[REG-TOPIC-056] removes source inline colors from canonical Callout titles', () => {
    const html = sanitizeLinuxDoContentHtml(
      '<blockquote><p>[!warning] <strong STYLE="color:#000;background-color:#fff">Title</strong><br>Body</p></blockquote>',
      []
    );

    expect(html).toContain('<strong>Title</strong>');
    expect(html).not.toContain('style=');
  });

  it('[REG-TOPIC-056] recognizes a title line break without converting an in-paragraph marker', () => {
    const html = sanitizeLinuxDoContentHtml(
      [
        '<blockquote><p>[!warning] Title\nBody <strong>continues</strong></p></blockquote>',
        '<blockquote><p>Prefix [!warning] stays ordinary</p></blockquote>'
      ].join(''),
      []
    );

    expect(html).toContain('<div class="forum-callout-title forum-callout-tone-warning">Title</div>');
    expect(html).toContain('<div class="forum-callout-content"><p>Body <strong>continues</strong></p></div>');
    expect(html).toContain('<blockquote><p>Prefix [!warning] stays ordinary</p></blockquote>');
  });

  it('[REG-TOPIC-056] preserves rich bodies and separates ordinary and nested quotes', () => {
    const html = sanitizeLinuxDoContentHtml(
      [
        '<blockquote><p>[!warning] Outer<br>Before</p>',
        '<blockquote><p>[!tip] Nested<br><a href="/guide"><img src="/tip.png" alt="tip">Guide</a></p></blockquote>',
        '<blockquote><p>Ordinary nested quote</p></blockquote>',
        '<ul><li>List</li></ul><pre><code>const value = 1;</code></pre>',
        '<table><tbody><tr><td>Cell</td></tr></tbody></table></blockquote>',
        '<blockquote><p>Ordinary outer quote</p><blockquote><p>[!success] Done<br>Inside</p></blockquote></blockquote>'
      ].join(''),
      []
    );

    expect(html.match(/data-forum-callout="true"/g)).toHaveLength(3);
    expect(html).toContain('<blockquote><p>Ordinary nested quote</p></blockquote>');
    expect(html).toContain('<blockquote><p>Ordinary outer quote</p><blockquote data-forum-callout="true"');
    expect(html).toContain('<a href="https://linux.do/guide"><img src="https://linux.do/tip.png" alt="tip">Guide</a>');
    expect(html).toContain('<ul><li>List</li></ul>');
    expect(html).toContain('<div class="forum-terminal-code">const&nbsp;value&nbsp;=&nbsp;1;</div>');
    expect(html).toContain('<table><tbody><tr><td>Cell</td></tr></tbody></table>');
  });

  it('[REG-TOPIC-056] ignores forged semantics and caps nested Callouts at 100', () => {
    const forged = sanitizeLinuxDoContentHtml(
      '<blockquote data-forum-callout="true" data-forum-callout-type="danger"><div class="forum-callout-title">Forged</div><div class="forum-callout-content">Body</div></blockquote>',
      []
    );
    const forgedTone = sanitizeLinuxDoContentHtml('<p class="safe forum-callout-tone-danger">Forged tone</p>', []);
    const entityForgedTone = sanitizeLinuxDoContentHtml(
      '<p class="safe forum&#45;callout-tone-danger">Entity forged tone</p>',
      []
    );
    const uppercaseForgedTone = sanitizeLinuxDoContentHtml(
      '<p CLASS="forum-callout-tone-danger">Uppercase forged tone</p>',
      []
    );
    const nested =
      Array.from({ length: 101 }, (_, index) => `<blockquote><p>[!note] Level ${index + 1}</p>`).join('') +
      'Body' +
      '</blockquote>'.repeat(101);
    const limited = sanitizeLinuxDoContentHtml(nested, []);

    expect(forged).toBe('<blockquote><div>Forged</div><div>Body</div></blockquote>');
    expect(forgedTone).toBe('<p class="safe">Forged tone</p>');
    expect(entityForgedTone).toBe('<p class="safe">Entity forged tone</p>');
    expect(uppercaseForgedTone).toBe('<p>Uppercase forged tone</p>');
    expect(limited.match(/data-forum-callout="true"/g)).toHaveLength(100);
    expect(limited.match(/\[!note\]/g)).toHaveLength(1);
  });

  it('[REG-TOPIC-056] strips Callout markers only from Discourse excerpts', () => {
    expect(stripDiscourseCalloutMarkersFromExcerpt('[!warning]- 注意\n正文 [!tip]+ 建议')).toBe('注意\n正文 建议');
  });

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

    expect(
      splitDiscourseContentHtml(html, [first, second]).map((part) =>
        part.type === 'poll' ? `poll:${part.poll.name}` : part.html
      )
    ).toEqual(['<p>before</p>', 'poll:first', '<p>after</p>', 'poll:second']);
  });

  it('[REG-PERF-008] skips DOM parsing when ordinary content has no poll placeholder', async () => {
    const parseHtml = vi.fn(() => {
      throw new Error('ordinary content should not be parsed here');
    });
    vi.resetModules();
    vi.doMock('@/domain/forum/html', () => ({
      absoluteUrl: vi.fn(),
      parseHtml,
      textContentFromHtml: vi.fn()
    }));
    try {
      const { splitDiscourseContentHtml: splitWithoutPoll } = await import('./content');

      expect(splitWithoutPoll('<p>ordinary content</p>', [])).toEqual([
        { type: 'html', html: '<p>ordinary content</p>' }
      ]);
      expect(parseHtml).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/domain/forum/html');
      vi.resetModules();
    }
  });

  it('escapes poll names used in placeholder attributes', () => {
    expect(discoursePollPlaceholder('a"<&')).toContain('name="a&quot;&lt;&amp;"');
  });

  it('[REG-TOPIC-033] does not decode DOM attributes a second time', () => {
    const metadata = discourseQuoteMetadata(
      '<aside class="quote" data-post="2" data-display-name="Alice &amp;lt;Admin&amp;gt;"><div class="title"></div><blockquote>hi</blockquote></aside>',
      'linuxdo',
      '1'
    );

    expect(metadata.quotedPosts[0]?.author).toEqual({ label: 'Alice &lt;Admin&gt;' });
  });

  it('[REG-TOPIC-053] extracts a cross-topic reply quote with its complete identity', () => {
    const metadata = discourseQuoteMetadata(
      '<aside class="quote" data-topic="2679944" data-post="7" data-username="alice"><div class="title">Referenced topic</div><blockquote>Cross-topic preview.</blockquote></aside><p>Reply body.</p>',
      'linuxdo',
      '2685882'
    );

    expect(metadata.quotedPosts).toEqual([
      {
        reference: { source: 'linuxdo', topicId: '2679944', postNumber: 7 },
        author: { label: 'alice', username: 'alice' },
        preview: 'Cross-topic preview.'
      }
    ]);
    expect(metadata.html).toBe('<p>Reply body.</p>');
  });

  it('[REG-TOPIC-056] removes Callout markers from quoted-post previews', () => {
    const metadata = discourseQuoteMetadata(
      '<aside class="quote" data-topic="342888" data-post="1"><div class="title"></div><blockquote><p>盘点徽章</p><blockquote><p>[!warning] 注意！！<br>正文</p></blockquote></blockquote></aside>',
      'linuxdo',
      '2685882'
    );

    expect(metadata.quotedPosts[0]?.preview).toBe('盘点徽章 注意！！ 正文');
  });

  it('[REG-TOPIC-053] keeps rich metadata when the same quoted post appears again with fewer fields', () => {
    const metadata = discourseQuoteMetadata(
      '<aside class="quote" data-topic="2679944" data-post="7" data-username="alice"><div class="title"><span class="quote-title__text-content"><a href="https://linux.do/t/topic/2679944/7">Referenced topic</a></span></div><blockquote>Cross-topic preview.</blockquote></aside><aside class="quote" data-topic="2679944" data-post="7"><div class="title"></div><blockquote></blockquote></aside><p>Reply body.</p>',
      'linuxdo',
      '2685882'
    );

    expect(metadata.quotedPosts).toEqual([
      {
        reference: { source: 'linuxdo', topicId: '2679944', postNumber: 7 },
        author: { label: 'alice', username: 'alice' },
        preview: 'Cross-topic preview.',
        topicTitle: 'Referenced topic',
        topicUrl: 'https://linux.do/t/topic/2679944/7'
      }
    ]);
    expect(metadata.html).toBe('<p>Reply body.</p>');
  });
});
