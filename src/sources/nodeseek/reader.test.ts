import { withTrackedParseHtml } from '../../../tests/helpers/trackedParseHtml';
import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';

describe('NodeSeek reader', () => {
  it('[REG-PERF-017] parses each feed and Google search response once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const feedMarker = 'data-page-marker="feed-once"';
      const searchMarker = 'data-page-marker="search-once"';
      const feedPage = [
        `<html ${feedMarker}><body><ul>`,
        '<li class="post-list-item"><a class="post-title" href="/post-101-1"><h3>Feed topic</h3></a></li>',
        '</ul></body></html>'
      ].join('');
      const searchPage = [
        `<html ${searchMarker}><head><title>Google site:nodeseek.com</title></head><body>`,
        '<a href="https://www.nodeseek.com/post-202-1"><h3>Search topic</h3></a>',
        '</body></html>'
      ].join('');
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = String(input);
        const response = new Response(url.includes('google.com/search') ? searchPage : feedPage, {
          headers: { 'content-type': 'text/html' }
        });
        Object.defineProperty(response, 'url', { value: url });
        return response;
      });

      const { getNodeSeekFeed, searchNodeSeek } = await import('./reader');
      const feed = await getNodeSeekFeed({ fetcher });
      const search = await searchNodeSeek('Search', { fetcher });

      expect(feed.items.map(({ id }) => id)).toEqual(['101']);
      expect(search.items.map(({ id }) => id)).toEqual(['202']);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(feedMarker))).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(searchMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] parses the current-user page once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const marker = 'data-page-marker="nodeseek-current-user-once"';
      const page = `<html ${marker}><body><nav><a class="Username" href="/space/42">alice</a></nav></body></html>`;
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const response = new Response(page, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      });

      const { getNodeSeekCurrentUserProfile } = await import('./reader');
      const profile = await getNodeSeekCurrentUserProfile({ fetcher });

      expect(profile).toMatchObject({ id: '42', username: 'alice' });
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-010] parses and decodes one topic page exactly once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const jsonParseSpy = vi.spyOn(JSON, 'parse');
      try {
        const marker = 'data-full-page-marker="topic-321"';
        const contentMarker = 'data-embedded-content-marker="topic-321"';
        const payload = Buffer.from(
          JSON.stringify({
            postData: {
              postId: 321,
              title: 'Single parse topic',
              op: { name: 'alice' },
              comments: [
                {
                  commentId: 1,
                  content: `<p ${contentMarker}>正文内容</p>`,
                  floorIndex: 0,
                  poster: { name: 'alice' },
                  time: { createdDate: '2026-08-15T00:00:00.000Z' }
                }
              ]
            }
          })
        ).toString('base64');
        const fetcher = vi.fn<Fetcher>(async (input) => {
          const response = new Response(`<script>${payload}</script><div ${marker}></div>`, {
            headers: { 'content-type': 'text/html' }
          });
          Object.defineProperty(response, 'url', { value: String(input) });
          return response;
        });

        const { getNodeSeekTopic } = await import('./reader');
        const topic = await getNodeSeekTopic('321', { fetcher });
        const fullPageParses = trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker));
        const openingContentParses = trackedParseHtml.mock.calls.filter(([value]) =>
          String(value).includes(contentMarker)
        );
        const embeddedDecodes = jsonParseSpy.mock.calls.filter(([value]) => String(value).includes('"postId":321'));

        expect(topic).toMatchObject({ id: '321', title: 'Single parse topic' });
        expect(fullPageParses).toHaveLength(1);
        expect(openingContentParses).toHaveLength(1);
        expect(embeddedDecodes).toHaveLength(1);
      } finally {
        jsonParseSpy.mockRestore();
      }
    });
  });

  it('[REG-PERF-010] prepares one 1413-image rendered topic with two DOM parses', async () => {
    await withTrackedParseHtml(async (trackedParseHtml, actualParseHtml) => {
      const marker = 'data-topic-perf-marker="opening"';
      const boundaryOrder: string[] = [];
      trackedParseHtml.mockImplementation((...args: Parameters<typeof actualParseHtml>) => {
        if (String(args[0]).includes('<html>') && String(args[0]).includes(marker)) boundaryOrder.push('page-parse');
        return actualParseHtml(...args);
      });
      const images = Array.from(
        { length: 1_413 },
        (_, index) => `<img src="https://img.example/${index}.webp" alt="image-${index}">`
      ).join('');
      const embeddedMarker = 'data-discarded-topic-perf-marker="opening"';
      const payload = Buffer.from(
        JSON.stringify({
          postData: {
            postId: 654,
            title: 'Embedded giant topic',
            op: { name: 'alice' },
            comments: [
              {
                commentId: 1,
                floorIndex: 0,
                poster: { name: 'alice' },
                content: `<p ${embeddedMarker}>${images}</p>`,
                time: { createdDate: '2026-08-15T00:00:00.000Z' }
              }
            ]
          }
        })
      ).toString('base64');
      const page = [
        `<html><head><title>Rendered giant topic</title><script>${payload}</script></head><body>`,
        '<a class="post-title" href="/post-654-1">Rendered giant topic</a>',
        '<div class="content-item">',
        '<a href="/space/1">alice</a><time datetime="2026-08-15T00:00:00.000Z"></time>',
        `<div class="post-content"><p ${marker}>${images}</p></div>`,
        '</div></body></html>'
      ].join('');
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const response = new Response(page, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      });

      try {
        const [
          { getNodeSeekTopic },
          { prepareTopicContent, requirePreparedForumContent },
          { beginDiagnosticTrace, finishDiagnosticTrace, setDiagnosticWriter }
        ] = await Promise.all([
          import('./reader'),
          import('@/domain/forum/topicContentSplit'),
          import('@/platform/diagnostics/diagnostics')
        ]);
        const lines: string[] = [];
        setDiagnosticWriter((line) => {
          lines.push(line);
          const event = JSON.parse(line);
          if (event.phase === 'parse' && event.state === 'body-ready') boundaryOrder.push('body-ready');
        });
        const trace = beginDiagnosticTrace('topic', 'open', { source: 'nodeseek' });
        const topic = await Reflect.apply(getNodeSeekTopic, undefined, ['654', { fetcher }, trace]);
        finishDiagnosticTrace(trace, 'success');
        const contentParses = trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker));
        const discardedContentParses = trackedParseHtml.mock.calls.filter(([value]) =>
          String(value).includes(embeddedMarker)
        );
        const parseStates = lines
          .map((line) => JSON.parse(line))
          .filter(({ phase }) => phase === 'parse')
          .map(({ state }) => state);

        expect(
          requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
            polls: topic.polls,
            role: 'opening',
            source: topic.source,
            topicId: topic.id
          }).previewImages
        ).toHaveLength(1_413);
        expect(contentParses).toHaveLength(2);
        expect(discardedContentParses).toHaveLength(0);
        expect(prepareTopicContent(topic)).toBe(topic);
        expect(parseStates).toEqual(['body-ready', 'source-parsed', 'content-plan-ready']);
        expect(boundaryOrder.slice(0, 2)).toEqual(['body-ready', 'page-parse']);
      } finally {
        const { setDiagnosticWriter } = await import('@/platform/diagnostics/diagnostics');
        setDiagnosticWriter(null);
      }
    });
  });

  it('[REG-PERF-017] reuses the rendered page DOM while preparing an inline poll', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const marker = 'data-rendered-poll-marker="poll-once"';
      const page = [
        '<html><head><title>Rendered poll</title></head><body>',
        '<div class="content-item"><a href="/space/1">alice</a>',
        `<article class="post-content"><div ${marker}><p>投票前</p>`,
        '<div class="vote-panel"><form class="vote-form" data-vote-id="2443">',
        '<h2>常用系统</h2>',
        '<label><input type="radio" name="ids" value="71">Debian</label>',
        '<label><input type="radio" name="ids" value="72">ArchLinux</label>',
        '</form></div><p>投票后</p></div></article></div>',
        '</body></html>'
      ].join('');
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const response = new Response(page, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      });

      const { getNodeSeekTopic } = await import('./reader');
      const topic = await getNodeSeekTopic('2443', { fetcher });

      expect(topic.polls?.map(({ id }) => id)).toEqual(['2443']);
      expect(topic.contentHtml).toContain('投票前');
      expect(topic.contentHtml).toContain('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
      expect(topic.contentHtml).toContain('投票后');
      expect(topic.contentHtml).not.toContain('<form');
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker))).toHaveLength(2);
    });
  });

  it('[REG-PERF-017] prepares a rendered reply and signature without a second fragment parse', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const replyMarker = 'data-reply-marker="nodeseek-reply-once"';
      const signatureMarker = 'data-signature-marker="nodeseek-signature-once"';
      const page = [
        '<html><head><title>Rendered replies</title></head><body>',
        '<a class="post-title" href="/post-919-1">Rendered replies</a>',
        '<div class="content-item"><a href="/space/1">alice</a><div class="post-content"><p>正文</p></div></div>',
        '<li class="content-item" data-comment-id="2"><a href="/space/2">bob</a><span class="floor">1楼</span>',
        `<div class="post-content"><p ${replyMarker}>回复</p></div>`,
        `<div class="signature"><p ${signatureMarker}>签名</p></div></li>`,
        '</body></html>'
      ].join('');
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const response = new Response(page, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      });

      const [{ getNodeSeekTopic }, { requirePreparedForumContent }] = await Promise.all([
        import('./reader'),
        import('@/domain/forum/topicContentSplit')
      ]);
      const topic = await getNodeSeekTopic('919', { fetcher });
      const reply = topic.replies[0];

      expect(
        requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
          role: 'reply',
          source: 'nodeseek'
        }).rows
      ).not.toHaveLength(0);
      expect(
        requirePreparedForumContent(reply.preparedSignature, reply.signatureHtml, {
          role: 'signature',
          source: 'nodeseek'
        }).rows
      ).not.toHaveLength(0);
      expect(
        trackedParseHtml.mock.calls.filter(
          ([value]) => String(value).includes(replyMarker) && !String(value).includes('<html>')
        )
      ).toHaveLength(1);
      expect(
        trackedParseHtml.mock.calls.filter(
          ([value]) => String(value).includes(signatureMarker) && !String(value).includes('<html>')
        )
      ).toHaveLength(1);
    });
  });
});
