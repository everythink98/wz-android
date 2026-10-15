import { describe, expect, it } from 'vitest';
import {
  discourseQuotedPostMetadataFromNode,
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  replyForQuotedPost,
  topicForQuotedPost
} from './quotedPosts';
import type { Reply } from './models';
import { parseForumContentHtml } from './html';

describe('quoted post contract', () => {
  it.each([
    {
      src: '/user_avatar/linux.do/alice/48/1.png',
      avatar: 'https://linux.do/user_avatar/linux.do/alice/48/1.png'
    },
    {
      src: '//cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png',
      avatar: 'https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png'
    },
    { src: 'http://cdn.example/alice.png', avatar: 'http://cdn.example/alice.png' },
    { src: 'https://cdn.example/alice.png', avatar: 'https://cdn.example/alice.png' },
    { src: 'javascript:alert(1)', avatar: undefined },
    { src: 'file:///tmp/alice.png', avatar: undefined },
    { src: 'data:image/png;base64,iVBORw0KGgo=', avatar: undefined }
  ])('retains only resolved HTTP author avatars from "$src"', ({ src, avatar }) => {
    const root = parseForumContentHtml(
      '<aside class="quote" data-topic="42" data-post="1" data-username="alice">' +
        `<div class="title"><img class="avatar" src="${src}"></div></aside>`
    );
    const quote = root.querySelector('aside');
    if (!quote) throw new Error('Expected a quoted post.');

    expect(discourseQuotedPostMetadataFromNode(quote, 'linuxdo')?.author).toEqual({
      label: 'alice',
      username: 'alice',
      ...(avatar ? { avatar } : {})
    });
  });

  it('finds the topic link outside the preferred title container when that container only has author text', () => {
    const root = parseForumContentHtml(
      '<aside class="quote" data-topic="42" data-post="1">' +
        '<div class="title"><a href="https://linux.do/t/topic/42">Quoted topic</a>' +
        '<span class="quote-title__text-content">alice:</span></div></aside>'
    );
    const quote = root.querySelector('aside');
    if (!quote) throw new Error('Expected a quoted post.');

    expect(discourseQuotedPostMetadataFromNode(quote, 'linuxdo')).toEqual({
      reference: { source: 'linuxdo', topicId: '42', postNumber: 1 },
      author: { label: 'alice' },
      topicTitle: 'Quoted topic',
      topicUrl: 'https://linux.do/t/topic/42'
    });
  });

  it.each([
    { topicLink: '', topicTitle: undefined, topicUrl: undefined },
    {
      topicLink: '<a href="https://linux.do/t/topic/42">HTTP: topic title</a>',
      topicTitle: 'HTTP: topic title',
      topicUrl: 'https://linux.do/t/topic/42'
    }
  ])('preserves linked authors separately from topic URL "$topicUrl"', ({ topicLink, topicTitle, topicUrl }) => {
    const root = parseForumContentHtml(
      '<aside class="quote" data-topic="42" data-post="1">' +
        `<div class="title"><a href="/u/alice">alice</a>: ${topicLink}</div>` +
        '<blockquote>quoted body</blockquote></aside>'
    );
    const quote = root.querySelector('aside');
    if (!quote) throw new Error('Expected a quoted post.');

    const metadata = discourseQuotedPostMetadataFromNode(quote, 'linuxdo');
    expect(metadata?.author).toEqual({ label: 'alice' });
    expect(metadata?.topicTitle).toBe(topicTitle);
    expect(metadata?.topicUrl).toBe(topicUrl);
    expect(metadata && topicForQuotedPost(metadata)).toMatchObject({ source: 'linuxdo', id: '42' });
  });

  it.each([
    { authorText: '', topicTitle: 'HTTP: topic title', author: undefined },
    { authorText: '', topicTitle: 'Notes:', author: undefined },
    { authorText: '<span>alice:</span> ', topicTitle: 'HTTP: topic title', author: { label: 'alice' } }
  ])(
    'keeps topic title "$topicTitle" separate from author text "$authorText"',
    ({ authorText, topicTitle, author }) => {
      const root = parseForumContentHtml(
        '<aside class="quote" data-topic="42" data-post="1">' +
          `<div class="title">${authorText}<span><a href="https://linux.do/t/topic/42">${topicTitle}</a></span></div>` +
          '<blockquote>quoted body</blockquote></aside>'
      );
      const quote = root.querySelector('aside');
      if (!quote) throw new Error('Expected a quoted post.');

      const metadata = discourseQuotedPostMetadataFromNode(quote, 'linuxdo');
      expect(metadata?.author).toEqual(author);
      expect(metadata).toMatchObject({ topicTitle, topicUrl: 'https://linux.do/t/topic/42', preview: 'quoted body' });
    }
  );

  it('uses a valid quote reference without a URL and refuses conflicting topic URLs', () => {
    const reference = { source: 'linuxdo' as const, topicId: '42', postNumber: 6 };
    expect(topicForQuotedPost({ reference })).toMatchObject({
      source: 'linuxdo',
      id: '42',
      url: 'https://linux.do/t/42'
    });
    expect(topicForQuotedPost({ reference, topicUrl: '/t/topic/42/6' }, 'https://linux.do/t/99')).toMatchObject({
      id: '42'
    });
    for (const topicUrl of ['https://linux.do/t/99', 'https://www.v2ex.com/t/42', 'https://evil.example/t/42']) {
      expect(topicForQuotedPost({ reference, topicUrl })).toBeNull();
      const node = parseForumContentHtml(
        '<aside class="quote" data-topic="42" data-post="6">' +
          `<div class="title"><a href="/u/alice">alice</a>: <a href="${topicUrl}">Quoted topic</a></div></aside>`
      ).querySelector('aside');
      if (!node) throw new Error('Expected a quoted post.');
      const metadata = discourseQuotedPostMetadataFromNode(node, 'linuxdo');
      expect(metadata?.topicUrl).toBe(topicUrl);
      expect(metadata && topicForQuotedPost(metadata)).toBeNull();
    }
    expect(topicForQuotedPost({ reference: { ...reference, topicId: '../42' } })).toBeNull();
  });
  it('normalizes topic-body and reply quotes to the same reference shape', () => {
    const topicBodyReference = discourseQuotedPostReferenceFromAttributes(
      'linuxdo',
      {
        'data-topic': '2427021',
        'data-post': '1'
      },
      '2427605'
    );
    const replyReference = quotedPostReferenceFromReply('linuxdo', '2427605', 1);

    expect(topicBodyReference).toEqual({ source: 'linuxdo', topicId: '2427021', postNumber: 1 });
    expect(
      discourseQuotedPostReferenceFromAttributes(
        'linuxdo',
        {
          'data-post': '2'
        },
        '42'
      )
    ).toEqual({ source: 'linuxdo', topicId: '42', postNumber: 2 });
    expect(replyReference).toEqual({ source: 'linuxdo', topicId: '2427605', postNumber: 1 });
  });

  it('keeps same-numbered posts from different topics in separate cache entries', () => {
    const first = quotedPostReferenceFromReply('linuxdo', '100', 1);
    const second = quotedPostReferenceFromReply('linuxdo', '200', 1);

    expect(first && quotedPostReferenceKey(first)).toBe('linuxdo:100:1');
    expect(second && quotedPostReferenceKey(second)).toBe('linuxdo:200:1');
  });

  it('prefers the current same-topic reply over a stale quote cache entry', () => {
    const currentReply: Reply = {
      author: 'current',
      contentHtml: '<p>current</p>',
      createdAt: '2026-08-15T00:00:00.000Z',
      floor: 2
    };
    const cachedReply: Reply = {
      ...currentReply,
      author: 'cached',
      contentHtml: '<p>cached</p>'
    };

    expect(
      replyForQuotedPost(
        { source: 'nodeseek', topicId: '100', postNumber: 2 },
        'nodeseek',
        '100',
        new Map([[2, currentReply]]),
        { 'nodeseek:100:2': cachedReply }
      )
    ).toBe(currentReply);
  });
});
