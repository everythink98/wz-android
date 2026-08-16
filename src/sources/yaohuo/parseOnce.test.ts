import { withTrackedParseHtml } from '../../../tests/helpers/trackedParseHtml';
import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';

describe('Yaohuo page parsing', () => {
  it('[REG-PERF-017] prepares opening and reply content from one fragment parse each', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const openingMarker = 'data-content-marker="yaohuo-opening-once"';
      const replyMarker = 'data-content-marker="yaohuo-reply-once"';

      const [{ parseYaohuoRepliesDocument, parseYaohuoTopicHtml }, { requirePreparedForumContent }] = await Promise.all(
        [import('./topicParser'), import('@/domain/forum/topicContentSplit')]
      );
      const topic = parseYaohuoTopicHtml(
        `<div class="content">[标题] Prepared topic (阅1) [时间] 2026-08-15 10:00</div><div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div><div class="bbscontent"><!--listS--><p ${openingMarker}>正文</p><!--listE--></div>`,
        { id: '606', url: 'https://www.yaohuo.me/bbs-606.html' }
      );
      const replies = parseYaohuoRepliesDocument(
        trackedParseHtml(
          `<div class="line1">[1楼]<a href="/userinfo.aspx?touserid=2">bob</a><p ${replyMarker}>回复</p> 05-20 10:00</div>`
        ),
        { page: 1, limit: 30 }
      );
      const reply = replies.items[0];

      expect(
        requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
          polls: topic.polls,
          role: 'opening',
          source: 'yaohuo',
          topicId: topic.id
        }).regions
      ).not.toHaveLength(0);
      expect(
        requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
          role: 'reply',
          source: 'yaohuo'
        }).regions
      ).not.toHaveLength(0);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(openingMarker))).toHaveLength(2);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(replyMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] parses each normal list and replies page once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const listMarker = 'data-page-marker="yaohuo-list-once"';
      const repliesMarker = 'data-page-marker="yaohuo-replies-once"';

      const [{ parseYaohuoListHtml }, { parseYaohuoRepliesDocument }] = await Promise.all([
        import('./feedParser'),
        import('./topicParser')
      ]);
      const list = parseYaohuoListHtml(
        `<html ${listMarker}><body><div class="listdata"><a href="/bbs-101.html">列表主题</a>/alice/阅1/05-20 10:00</div><a href="?page=2">下一页</a></body></html>`,
        { page: 1, limit: 30 }
      );
      const replies = parseYaohuoRepliesDocument(
        trackedParseHtml(
          `<html ${repliesMarker}><body><div class="line1">[1楼]<a href="/userinfo.aspx?touserid=1">alice</a> 正文 05-20 10:00</div><a href="?page=2">下一页</a></body></html>`
        ),
        { page: 1, limit: 30 }
      );

      expect(list.items).toHaveLength(1);
      expect(replies.items).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(listMarker))).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(repliesMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] reuses the parsed reply page when confirming a target floor', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const pageMarker = 'data-page-marker="yaohuo-target-floor-once"';
      const pageHtml = `<html ${pageMarker}><body><input name="page" value="1"><div class="line1">[1楼]<a href="/userinfo.aspx?touserid=1">alice</a> 正文 05-20 10:00</div></body></html>`;

      const { getYaohuoRepliesDirect } = await import('./reader');
      const replies = await getYaohuoRepliesDirect({
        id: '606',
        limit: 30,
        order: 'oldest',
        position: { kind: 'start' },
        yaohuoFetcher: vi.fn(async () => new Response(pageHtml, { status: 200 }))
      });

      expect(replies.items).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(pageMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017] parses each user profile, topic, and reply page once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const profileMarker = 'data-page-marker="yaohuo-user-profile-once"';
      const topicMarker = 'data-page-marker="yaohuo-user-topics-once"';
      const replyMarker = 'data-page-marker="yaohuo-user-replies-once"';
      const pages = {
        profile: `<html ${profileMarker}><body>昵称：alice<a href="/bbs/book_list_search.aspx?action=search&type=pub&key=1">帖子</a><a href="/bbs/book_re_my.aspx?touserid=1">回帖</a></body></html>`,
        topics: `<html ${topicMarker}><body><div class="listdata"><a href="/bbs-101.html">主题</a>/alice/阅1/05-20 10:00</div></body></html>`,
        replies: `<html ${replyMarker}><body><div class="listdata"><a href="/bbs-101.html">主题</a> 回复正文 05-20 10:00</div></body></html>`
      };
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = String(input);
        const body = /book_re_my/i.test(url)
          ? pages.replies
          : /book_list_search/i.test(url)
            ? pages.topics
            : pages.profile;
        const response = new Response(body, { status: 200 });
        Object.defineProperty(response, 'url', { value: url });
        return response;
      });

      const { getUserProfile } = await import('@/sources/sourceRead');
      const profile = await getUserProfile({ source: 'yaohuo', id: '1', fetcher });

      expect(profile.displayName).toContain('alice');
      expect(profile.topics.map(({ id }) => id)).toEqual(['101']);
      expect(profile.replies?.map(({ topicId }) => topicId)).toEqual(['101']);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(profileMarker))).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(topicMarker))).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(replyMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-017][NOTIFY-02] parses each notification page and sanitized fragment once', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const privatePageMarker = 'data-page-marker="yaohuo-private-detail-once"';
      const systemPageMarker = 'data-page-marker="yaohuo-system-detail-once"';
      const fragmentMarkers = [
        'yaohuo-detail-fragment-once',
        'yaohuo-chat-old-fragment-once',
        'yaohuo-chat-original-fragment-once',
        'yaohuo-chat-new-fragment-once',
        'yaohuo-system-fragment-once'
      ];
      const privatePage = `
      <html ${privatePageMarker}><body>
        <div class="content">
          <b>内容：</b><span data-content-marker="${fragmentMarkers[0]}">原消息<img src="/original.png"></span><br>
          <a href="/bbs/messagelist_add.aspx?touserid=9">回复</a>
        </div>
        <div class="listmms the_user">
          <div class="info"><span class="u_name"><label>Bob</label></span>2026/6/1 10:00</div>
          <div class="bubble"><div class="con"><img data-content-marker="${fragmentMarkers[1]}" src="/older.png"></div></div>
        </div>
        <div class="listmms the_user">
          <div class="info"><span class="u_name"><label>Bob</label></span>2026/6/2 10:00</div>
          <div class="bubble"><div class="con"><span data-content-marker="${fragmentMarkers[2]}">原消息<img src="/original.png"></span></div></div>
        </div>
        <div class="listmms the_me">
          <div class="info"><span class="u_name"><label>我</label></span>2026/6/3 10:00</div>
          <div class="bubble"><div class="con">回复内容：<br><span data-content-marker="${fragmentMarkers[3]}"><img src="/face.gif">新消息<a href="/bbs-321.html">主题</a></span> |</div></div>
        </div>
      </body></html>
    `;
      const systemPage = `<html ${systemPageMarker}><body><div class="content"><b>内容：</b><span data-content-marker="${fragmentMarkers[4]}">系统公告</span></div></body></html>`;
      const fetcher = vi.fn<Fetcher>(
        async (input) =>
          new Response(String(input).includes('id=42') ? systemPage : privatePage, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
      );

      const { yaohuoNotificationAdapter } = await import('./notifications');
      const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
      const privateItem = {
        source: 'yaohuo' as const,
        id: '41',
        kind: 'private-message' as const,
        actor: { name: 'Bob' },
        title: '私信',
        createdAt: null,
        unread: false,
        target: {
          type: 'message-detail' as const,
          messageId: '41',
          url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
        }
      };
      const systemItem = {
        ...privateItem,
        id: '42',
        kind: 'system' as const,
        actor: { name: '系统通知' },
        title: '公告',
        target: { ...privateItem.target, messageId: '42', url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=42' }
      };
      const privateDetail = await yaohuoNotificationAdapter.loadDetail(privateItem, access);
      const systemDetail = await yaohuoNotificationAdapter.loadDetail(systemItem, access);

      expect(privateDetail.contentHtml).toContain('原消息');
      expect(
        privateDetail.messages?.map(({ author, createdAt, contentHtml }) => ({ author, createdAt, contentHtml }))
      ).toEqual([
        {
          author: 'Bob',
          createdAt: '2026-06-01T02:00:00.000Z',
          contentHtml: expect.stringContaining('src="https://www.yaohuo.me/older.png"')
        },
        { author: '我', createdAt: '2026-06-03T02:00:00.000Z', contentHtml: expect.stringContaining('新消息') }
      ]);
      expect(privateDetail.messages?.[1]?.contentHtml).toContain('src="https://www.yaohuo.me/face.gif"');
      expect(privateDetail.messages?.[1]?.contentHtml).toContain('href="https://www.yaohuo.me/bbs-321.html"');
      expect(privateDetail.messages?.[1]?.contentHtml).not.toMatch(/回复内容|\|\s*$/);
      expect(privateDetail.messages?.every((message) => !('contentKey' in message))).toBe(true);
      expect(privateDetail.reply).toEqual({ format: 'plain-text' });
      expect(systemDetail.contentHtml).toContain('系统公告');
      expect(systemDetail).not.toHaveProperty('messages');
      expect(systemDetail).not.toHaveProperty('reply');
      expect
        .soft(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(privatePageMarker)))
        .toHaveLength(1);
      expect
        .soft(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(systemPageMarker)))
        .toHaveLength(1);
      for (const marker of fragmentMarkers) {
        expect
          .soft(
            trackedParseHtml.mock.calls.filter(
              ([value]) => String(value).includes(marker) && !String(value).includes('data-page-marker')
            )
          )
          .toHaveLength(1);
      }
    });
  });
});
