import { withTrackedParseHtml } from '../../../tests/helpers/trackedParseHtml';
import { describe, expect, it, vi } from 'vitest';

describe('V2EX detail parsing', () => {
  it('[REG-PERF-017] parses a member topics page once while preserving topics and cursor', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const marker = 'data-page-marker="v2ex-member-topics-once"';
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/members/show.json')
          ? new Response(JSON.stringify({ username: 'alice', avatar_normal: '/avatar/alice.png' }), {
              headers: { 'content-type': 'application/json' }
            })
          : new Response(
              `<html ${marker}><body><div class="cell"><a class="topic-link" href="/t/123">Topic title</a><a class="node" href="/go/qna">Questions</a><strong><a href="/member/alice">alice</a></strong><span title="2026-08-01 12:00:00"></span></div><a href="?p=2">2</a></body></html>`,
              { headers: { 'content-type': 'text/html' } }
            )
      );

      const { getV2exUserProfile } = await import('./account');
      const profile = await getV2exUserProfile('alice', 'alice', { fetcher, cursorType: 'topics' });

      expect(profile.topics.map(({ id, title }) => ({ id, title }))).toEqual([{ id: '123', title: 'Topic title' }]);
      expect(profile.nextTopicsCursor).toBe('2');
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] parses a member replies page once while preserving replies and cursor', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const marker = 'data-page-marker="v2ex-member-replies-once"';
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/members/show.json')
          ? new Response(JSON.stringify({ username: 'alice', avatar_normal: '/avatar/alice.png' }), {
              headers: { 'content-type': 'application/json' }
            })
          : new Response(
              `<html ${marker}><body><div class="dock_area">8 月 15 日 回复了 <a href="/t/456#reply3">Reply topic</a> › <a href="/go/qna">Questions</a></div><a href="?p=2">2</a></body></html>`,
              { headers: { 'content-type': 'text/html' } }
            )
      );

      const { getV2exUserProfile } = await import('./account');
      const profile = await getV2exUserProfile('alice', 'alice', { fetcher, cursorType: 'replies' });

      expect(profile.replies?.map(({ topicId, topicTitle, floor }) => ({ topicId, topicTitle, floor }))).toEqual([
        { topicId: '456', topicTitle: 'Reply topic', floor: 3 }
      ]);
      expect(profile.nextRepliesCursor).toBe('2');
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] prepares opening and HTML reply content from one fragment parse each', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const openingMarker = 'data-content-marker="v2ex-opening-once"';
      const replyMarker = 'data-content-marker="v2ex-reply-once"';
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/topics/show.json')
          ? new Response(
              JSON.stringify([
                {
                  id: 505,
                  title: 'Prepared topic',
                  member: { username: 'alice' },
                  node: { name: 'qna', title: 'Questions' },
                  created: 1780558980,
                  replies: 1,
                  content_rendered: `<p ${openingMarker}>正文</p>`
                }
              ]),
              { headers: { 'content-type': 'application/json' } }
            )
          : new Response(
              `<html><body><div id="r_2"><span class="no">1</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content"><p ${replyMarker}>回复</p></div></div></body></html>`,
              { headers: { 'content-type': 'text/html' } }
            )
      );

      const [{ getV2exTopic }, { requirePreparedForumContent }] = await Promise.all([
        import('./reader'),
        import('@/domain/forum/topicContentSplit')
      ]);
      const topic = await getV2exTopic('505', { fetcher });
      const reply = topic.replies[0];

      expect(
        requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
          role: 'opening',
          source: 'v2ex',
          topicId: topic.id
        }).regions
      ).not.toHaveLength(0);
      expect(
        requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
          role: 'reply',
          source: 'v2ex'
        }).regions
      ).not.toHaveLength(0);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(openingMarker))).toHaveLength(1);
      expect(
        trackedParseHtml.mock.calls.filter(
          ([value]) => String(value).includes(replyMarker) && !String(value).includes('<html>')
        )
      ).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] reuses the parsed detail page for an access notice', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const marker = 'data-page-marker="v2ex-detail-once"';
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/topics/show.json')
          ? new Response(
              JSON.stringify([
                {
                  id: 404,
                  title: 'Private topic',
                  member: { username: 'alice' },
                  node: { name: 'qna', title: 'Questions' },
                  created: 1780558980,
                  replies: 0,
                  content_rendered: ''
                }
              ]),
              { headers: { 'content-type': 'application/json' } }
            )
          : new Response(`<html ${marker}><body><div id="Main">This topic is private.</div></body></html>`, {
              headers: { 'content-type': 'text/html' }
            })
      );

      const { getV2exTopic } = await import('./reader');
      const topic = await getV2exTopic('404', { fetcher });

      expect(topic.accessRequirement).toMatchObject({ type: 'permission' });
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(marker))).toHaveLength(1);
    });
  });
});
