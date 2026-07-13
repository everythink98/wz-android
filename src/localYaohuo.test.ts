import { describe, expect, it } from 'vitest';

import { parseYaohuoListHtml, parseYaohuoRepliesHtml, parseYaohuoUserProfileHtml, parseYaohuoUserRepliesHtml } from './localYaohuo';
import { sourceDiagnosticSummary } from './sourceAdapterDiagnostics';

describe('yaohuo reply parsing', () => {
  it('summarizes invalid list candidates and source replies with synthesized floors', () => {
    const list = parseYaohuoListHtml('<div class="listdata">broken row</div>');
    const replies = parseYaohuoRepliesHtml('<div class="line1">reply <a href="/userinfo.aspx?touserid=1">bob</a></div>');
    const repeated = parseYaohuoListHtml(`
      <div class="listdata"><a href="/bbs-1.html">topic</a>/author/阅1/2026-07-10 10:00</div>
      <a href="?page=1">下一页</a>
    `, { page: 1 });

    expect(sourceDiagnosticSummary(list)).toMatchObject({
      parserVariant: 'html-list',
      candidateCount: 1,
      validCount: 0,
      droppedCount: 1,
      isParseEmpty: true
    });
    expect(sourceDiagnosticSummary(replies)).toMatchObject({
      parserVariant: 'html-replies',
      candidateCount: 1,
      validCount: 1,
      missingFloorCount: 1
    });
    expect(sourceDiagnosticSummary(repeated)).toMatchObject({ hasRepeatedCursor: true });
  });

  it('marks only replies with the original own-delete link as deletable', () => {
    const replies = parseYaohuoRepliesHtml(`
      <div class="reline list-reply" data-floor="3">
        [<span class="floornumber">3</span><span>楼</span>]
        <span class="user-remanage">[
          <a class='delete-myfloor' href="/bbs/Book_re_del.aspx?action=go&amp;siteid=1000&amp;classid=177&amp;lpage=1&amp;page=1&amp;reid=17080475&amp;id=798458">删</a>]
        </span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=45245">流金岁月</a></span>
        <span class="retime">2026-06-30 21:30</span>
        <span class="retext">谢谢</span>
      </div>
      <div class="reline list-reply" data-floor="4">
        [<span class="floornumber">4</span><span>楼</span>]
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=99">别人</a></span>
        <span class="retime">2026-06-30 21:31</span>
        <span class="retext">普通回复</span>
      </div>
    `, { url: 'https://www.yaohuo.me/bbs-798458.html' });

    expect(replies.items[0]).toMatchObject({
      author: '流金岁月',
      authorId: '45245',
      floor: 3,
      commentId: 17080475,
      canDelete: true,
      deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&lpage=1&page=1&reid=17080475&id=798458'
    });
    expect(replies.items[1]).toMatchObject({
      author: '别人',
      authorId: '99',
      floor: 4
    });
    expect(replies.items[1].canDelete).toBeUndefined();
    expect(replies.items[1].deletePath).toBeUndefined();
  });

  it('does not duplicate user reply rows when the page wraps replies in outer divs', () => {
    const replies = parseYaohuoUserRepliesHtml(`
      <div>
        <div>火友 (7) #71 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
      </div>
      <div>
        <div>火友 (7) #70 另一条回复。 2026-05-19 09:10 <a href="/bbs-66.html">查看</a></div>
      </div>
    `, { id: '7', username: '火友' });

    expect(replies).toHaveLength(2);
    expect(replies.map((reply) => reply.id)).toEqual([
      '66:71:2026-05-20T02:30:00.000Z',
      '66:70:2026-05-19T01:10:00.000Z'
    ]);
  });

  it('ignores outer containers that wrap multiple user reply rows', () => {
    const replies = parseYaohuoUserRepliesHtml(`
      <div>
        <div>火友 (7) #71 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
        <div>火友 (7) #70 另一条回复。 2026-05-19 09:10 <a href="/bbs-66.html">查看</a></div>
      </div>
    `, { id: '7', username: '火友' });

    expect(replies).toHaveLength(2);
    expect(replies.map((reply) => reply.floor)).toEqual([71, 70]);
    expect(replies[0].excerpt).toBe('妖火回复内容。');
    expect(replies[1].excerpt).toBe('另一条回复。');
  });

  it('drops link-only duplicate blocks for the same topic and reply time', () => {
    const replies = parseYaohuoUserRepliesHtml(`
      <div>火友 (7) #71 阿根廷没问题。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
      <div>火友 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
    `, { id: '7', username: '火友' });

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      floor: 71,
      excerpt: '阿根廷没问题。'
    });
  });

  it('keeps distinct meaningful replies that share a topic and minute without floors', () => {
    const replies = parseYaohuoUserRepliesHtml(`
      <div>火友 第一条回复。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
      <div>火友 第二条回复。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
    `, { id: '7', username: '火友' });

    expect(replies.map((reply) => reply.excerpt)).toEqual(['第一条回复。', '第二条回复。']);
    expect(new Set(replies.map((reply) => reply.id)).size).toBe(2);
  });

  it('preserves explicit zero profile counts', () => {
    const profile = parseYaohuoUserProfileHtml(`
      <div class="content">昵称:火友<br/>贴子(0).回复(3)</div>
    `, { id: '7', username: '火友' });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 3, postCount: 3 });
  });

  it('falls back to visible profile counts when structured statistics are malformed', () => {
    const profile = parseYaohuoUserProfileHtml(`
      <div class="uinfo-stat posts"><span class="value">未知</span></div>
      <div class="uinfo-stat replies"><span class="value">--</span></div>
      <div class="content">昵称:火友<br/>贴子(12).回复(34)</div>
    `, { id: '7', username: '火友' });

    expect(profile).toMatchObject({ topicCount: 12, replyCount: 34, postCount: 46 });
  });

  it('keeps yaohuo user topic and reply display times identical to the source text', () => {
    const profile = parseYaohuoUserProfileHtml(`
      <div class="content">昵称:火友<br/>贴子(1).回复(1)</div>
      <div class="listdata"><a href="/bbs-66.html?classid=177">妖火主题</a>/火友/阅1/2026-05-20 10:30</div>
    `, { id: '7', username: '火友' });
    const replies = parseYaohuoUserRepliesHtml(`
      <div>火友 (7) #71 阿根廷没问题。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
    `, { id: '7', username: '火友' });

    expect(profile.topics[0]).toMatchObject({
      displayTimeText: '2026-05-20 10:30'
    });
    expect(replies[0]).toMatchObject({
      createdAt: '2026-05-20T02:30:00.000Z',
      displayTimeText: '2026-05-20 10:30'
    });
  });
});
