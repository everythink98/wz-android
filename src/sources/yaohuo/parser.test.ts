import { describe, expect, it, vi } from 'vitest';
import { HTMLElement } from 'node-html-parser';

import { parseHtml } from '@/domain/forum/html';
import { parseYaohuoListHtml } from './feedParser';
import { parseYaohuoRepliesDocument, parseYaohuoTopicHtml } from './topicParser';
import { parseYaohuoUserProfileDocument, parseYaohuoUserRepliesDocument } from './userParser';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';

function parseReplies(html: string, options?: Parameters<typeof parseYaohuoRepliesDocument>[1]) {
  return parseYaohuoRepliesDocument(parseHtml(html), options);
}

function parseUserProfile(html: string, options: Parameters<typeof parseYaohuoUserProfileDocument>[1]) {
  return parseYaohuoUserProfileDocument(parseHtml(html), options);
}

function parseUserReplies(html: string, options: Parameters<typeof parseYaohuoUserRepliesDocument>[1]) {
  return parseYaohuoUserRepliesDocument(parseHtml(html), options);
}

describe('yaohuo reply parsing', () => {
  it('trims large empty article edges and attachment gaps with one bulk update per parent', () => {
    const setContent = vi.spyOn(HTMLElement.prototype, 'set_content');
    try {
      const detail = parseYaohuoTopicHtml(
        `<div class="content"><div class="bbscontent">${'<br>'.repeat(200)}<p>first</p><br><p>second</p><section><br><p>nested</p>${'<br>'.repeat(200)}<div class="attachment"><a href="/bbs/download.aspx?id=1">download</a></div><br><p>after</p><br></section>${'<br>'.repeat(200)}</div></div>`,
        { id: '1' }
      );
      expect(detail.contentHtml).toMatch(/^<p>first<\/p><br><p>second<\/p>/);
      expect(detail.contentHtml).toContain('<p>nested</p><div class="forum-attachment">');
      expect(detail.contentHtml).toContain('<p>after</p>');
      expect(detail.contentHtml).not.toMatch(/<br>$/);
      const updates = setContent.mock.calls.filter(([nodes]) => Array.isArray(nodes));
      expect(updates).toHaveLength(2);
      for (const [nodes] of updates) {
        if (!Array.isArray(nodes)) throw new Error('Expected bulk child update');
        expect(nodes.every((node) => node.parentNode?.childNodes.includes(node))).toBe(true);
      }
    } finally {
      setContent.mockRestore();
    }
  });

  it('summarizes invalid list candidates and source replies with synthesized floors', () => {
    const list = parseYaohuoListHtml('<div class="listdata">broken row</div>');
    const replies = parseReplies('<div class="line1">reply <a href="/userinfo.aspx?touserid=1">bob</a></div>');
    const repeated = parseYaohuoListHtml(
      `
      <div class="listdata"><a href="/bbs-1.html">topic</a>/author/阅1/2026-07-10 10:00</div>
      <a href="?page=1">下一页</a>
    `,
      { page: 1 }
    );

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
    const replies = parseReplies(
      `
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
    `,
      { url: 'https://www.yaohuo.me/bbs-798458.html' }
    );

    expect(replies.items[0]).toMatchObject({
      author: '流金岁月',
      authorId: '45245',
      floor: 3,
      canDelete: true,
      deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&lpage=1&page=1&reid=17080475&id=798458'
    });
    expect(replies.items[0]).not.toHaveProperty('commentId');
    expect(replies.items[1]).toMatchObject({
      author: '别人',
      authorId: '99',
      floor: 4
    });
    expect(replies.items[1].canDelete).toBeUndefined();
    expect(replies.items[1].deletePath).toBeUndefined();
  });

  it('sorts Yaohuo windows by floor and preserves reply targets', () => {
    const replies = parseReplies(
      `
      <div class="list-reply line1" id="floor-90" data-floor="90">
        [<span class="floornumber">90</span><span>楼</span>]
        [<a class="replyicon" href="/bbs/book_re.aspx?reply=90&amp;touserid=1000">回</a>]
        <span class="reother">回复<a href="/bbs/book_re.aspx?classid=177&amp;id=1560939&amp;tofloor=88&amp;page=16#floor-88">88楼</a></span>
        <span class="recolon">:</span>
        <span class="retext">阿根廷当然赢，但能赢几个是不确定的</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=1000">Clover</a></span>
        <span class="retime">07-03 13:46</span>
      </div>
      <div class="list-reply line2" id="floor-88" data-floor="88">
        [<span class="floornumber">88</span><span>楼</span>]
        <span class="retext">阿根廷没问题。</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=45245">流金岁月</a></span>
        <span class="retime">07-03 13:45</span>
      </div>
      `,
      {
        page: 16,
        url: 'https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=1560939&page=16'
      }
    );

    expect(replies.items.map(({ floor }) => floor)).toEqual([88, 90]);
    expect(replies.items.find(({ floor }) => floor === 90)).toMatchObject({
      floor: 90,
      replyTarget: {
        floor: 88,
        author: {
          id: '45245',
          name: '流金岁月',
          url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=45245'
        }
      }
    });

    const crossPage = parseReplies(
      `
      <div class="list-reply line1" id="floor-61" data-floor="61">
        <span class="reother">回复<a href="/bbs/book_re.aspx?id=1560939&amp;tofloor=30">30楼</a></span>
        <span class="retext">跨页回复</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=1000">Clover</a></span>
      </div>
      `,
      { page: 17, url: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1560939&page=17' }
    );
    expect(crossPage.items[0]).toMatchObject({ replyTarget: { floor: 30 } });
    expect(crossPage.items[0]?.replyTarget?.author).toBeUndefined();
  });

  it('does not duplicate user reply rows when the page wraps replies in outer divs', () => {
    const replies = parseUserReplies(
      `
      <div>
        <div>火友 (7) #71 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
      </div>
      <div>
        <div>火友 (7) #70 另一条回复。 2026-05-19 09:10 <a href="/bbs-66.html">查看</a></div>
      </div>
    `,
      { id: '7', username: '火友' }
    );

    expect(replies).toHaveLength(2);
    expect(replies.map((reply) => reply.id)).toEqual([
      '66:71:2026-05-20T02:30:00.000Z',
      '66:70:2026-05-19T01:10:00.000Z'
    ]);
  });

  it('ignores outer containers that wrap multiple user reply rows', () => {
    const replies = parseUserReplies(
      `
      <div>
        <div>火友 (7) #71 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
        <div>火友 (7) #70 另一条回复。 2026-05-19 09:10 <a href="/bbs-66.html">查看</a></div>
      </div>
    `,
      { id: '7', username: '火友' }
    );

    expect(replies).toHaveLength(2);
    expect(replies.map((reply) => reply.floor)).toEqual([71, 70]);
    expect(replies[0].excerpt).toBe('妖火回复内容。');
    expect(replies[1].excerpt).toBe('另一条回复。');
  });

  it('drops link-only duplicate blocks for the same topic and reply time', () => {
    const replies = parseUserReplies(
      `
      <div>火友 (7) #71 阿根廷没问题。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
      <div>火友 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
    `,
      { id: '7', username: '火友' }
    );

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      floor: 71,
      excerpt: '阿根廷没问题。'
    });
  });

  it('keeps yaohuo user topic and reply display times identical to the source text', () => {
    const profile = parseUserProfile(
      `
      <div class="content">昵称:火友<br/>贴子(1).回复(1)</div>
      <div class="listdata"><a href="/bbs-66.html?classid=177">妖火主题</a>/火友/阅1/2026-05-20 10:30</div>
    `,
      { id: '7', username: '火友' }
    );
    const replies = parseUserReplies(
      `
      <div>火友 (7) #71 阿根廷没问题。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>
    `,
      { id: '7', username: '火友' }
    );

    expect(profile.topics[0]).toMatchObject({
      displayTimeText: '2026-05-20 10:30'
    });
    expect(replies[0]).toMatchObject({
      createdAt: '2026-05-20T02:30:00.000Z',
      displayTimeText: '2026-05-20 10:30'
    });
  });

  it('preserves explicit zero statistics for a new Yaohuo user', () => {
    const profile = parseUserProfile(
      `
      <div class="content">昵称:新用户<br/>贴子(0).回复(0)</div>
    `,
      { id: '7', username: '新用户' }
    );

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('replaces a current-account id placeholder with the profile nickname', () => {
    const profile = parseUserProfile(
      `
      <div class="content">昵称:火友<br/>贴子(0).回复(0)</div>
    `,
      { id: '7', username: '7' }
    );

    expect(profile).toMatchObject({ id: '7', username: '火友', displayName: '火友' });
  });
});
