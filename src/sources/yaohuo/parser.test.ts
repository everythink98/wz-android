import { describe, expect, it, vi } from 'vitest';
import { HTMLElement } from 'node-html-parser';

import { parseHtml } from '@/domain/forum/html';
import { parseYaohuoListHtml } from './feedParser';
import { parseYaohuoRepliesDocument, parseYaohuoTopicHtml } from './topicParser';
import { parseYaohuoUserProfileDocument, parseYaohuoUserRepliesDocument } from './userParser';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { withHtmlWorkBudget } from '../../../tests/helpers/htmlWorkBudget';

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
  it('keeps literal HTML and repeated escapes in parsed list and reply excerpts', () => {
    const literal = '&amp;#32; &lt;x&gt;';
    const list = parseYaohuoListHtml(
      '<div class="listdata"><a href="/bbs-1.html">sample</a><span>' + literal + '</span></div>'
    );
    expect(list.items[0].excerpt).toContain('&#32; <x>');
    const replies = parseUserReplies(
      '<div class="listdata"><a href="/bbs-1.html">查看</a><span>' + literal + '</span></div>',
      { id: '1' }
    );
    expect(replies[0].excerpt).toBe('&#32; <x>');
    expect(replies[0].floor).toBeUndefined();
  });
  it.each(['ordinary outside divs', 'outside vote', 'outside floor link'])(
    'parses deep %s with bounded work while keeping body and poll navigation semantics',
    (layout) => {
      const depth = 512;
      const base = '<title>sample</title><section><div class="bbscontent">ordinary body</div></section>';
      const content =
        layout === 'ordinary outside divs'
          ? '<div>'.repeat(depth) + 'ordinary other' + '</div>'.repeat(depth)
          : '<span>'.repeat(depth) +
            (layout === 'outside vote'
              ? '<div class="vote-container"><div class="vote-option-row"><button class="vote-button" data-id="42" data-vid="1"></button><span class="vote-option-text">A</span></div></div>'
              : '<a href="/bbs/book_re.aspx?id=42&amp;tofloor=12">12楼</a>') +
            '</span>'.repeat(depth);
      const { result } = withHtmlWorkBudget(depth * 256 + 10000, () =>
        parseYaohuoTopicHtml(base + '<section>' + content + '</section>', { id: '42' })
      );
      expect(result.contentHtml).toBe('ordinary body');
      if (layout === 'outside vote')
        expect(result.polls?.[0].options).toEqual([{ id: '1', label: 'A', selected: false }]);
      if (layout === 'outside floor link') expect(result.replyWatermark).toBe(12);
    }
  );

  it('normalizes adjacent attachment blocks without processing already consumed siblings', () => {
    const detail = parseYaohuoTopicHtml(
      '<title>sample</title><div class="bbscontent">before<div class="attachment"><a href="/bbs/download.aspx?id=1">first</a></div><div class="attachment"><a href="/bbs/download.aspx?id=2">second</a></div>after</div>',
      { id: '42' }
    );
    expect(detail.contentHtml).toContain('before');
    expect(detail.contentHtml).toContain('after');
    expect(parseHtml(detail.contentHtml).querySelectorAll('.forum-attachment')).toHaveLength(2);
    expect(
      parseHtml(detail.contentHtml)
        .querySelectorAll('a')
        .map((node) => node.getAttribute('href'))
    ).toEqual(['https://www.yaohuo.me/bbs/download.aspx?id=1', 'https://www.yaohuo.me/bbs/download.aspx?id=2']);
  });
  it('removes repeated loaded poll copies in one phase while retaining the original poll and ordinary body', () => {
    const width = 512;
    const vote =
      '<div class="vote-container"><div class="vote-option-row"><button class="vote-button" data-id="42" data-vid="1"></button><span class="vote-option-text">A</span></div></div>';
    const html =
      '<title>sample</title><section><div class="bbscontent">body' + vote.repeat(width) + '</div></section>' + vote;
    const { result } = withHtmlWorkBudget(width * 700 + 10000, () => parseYaohuoTopicHtml(html, { id: '42' }));
    expect(result.contentHtml).toBe('body');
    expect(result.polls).toHaveLength(1);
    expect(result.polls?.[0].options).toEqual([{ id: '1', label: 'A', selected: false }]);
  });
  it('retains nested nonmatching poll containers without serializing every ancestor subtree', () => {
    const depth = 512;
    const vote =
      '<div class="vote-container"><div class="vote-option-row"><button class="vote-button" data-id="42" data-vid="1"></button><span class="vote-option-text">A</span></div></div>';
    const html =
      '<title>sample</title><section><div class="bbscontent">body' +
      '<div class="vote-container">'.repeat(depth) +
      'ordinary body' +
      '</div>'.repeat(depth) +
      '</div></section>' +
      vote;
    const { result } = withHtmlWorkBudget(depth * 700 + 10000, () => parseYaohuoTopicHtml(html, { id: '42' }));
    expect(parseHtml(result.contentHtml).textContent).toBe('bodyordinary body');
    expect(result.polls).toHaveLength(1);
    expect(result.polls?.[0].options).toEqual([{ id: '1', label: 'A', selected: false }]);
  });
  it('keeps reply totals distinct from origin floor evidence', () => {
    const onlyCount = parseYaohuoTopicHtml(
      '<div class="bbscontent">body</div><a href="/bbs/book_re.aspx?id=42">更多回帖(8)</a>',
      { id: '42' }
    );
    expect(onlyCount.replyCount).toBe(8);
    expect(onlyCount.replyWatermark).toBeUndefined();
    const withFloor = parseYaohuoTopicHtml(
      '<div class="bbscontent">body</div><span class="reother"><a href="/bbs/book_re.aspx?id=42&amp;tofloor=12">12楼</a></span>',
      { id: '42' }
    );
    expect(withFloor.replyWatermark).toBe(12);
    const authored = parseYaohuoTopicHtml(
      '<div class="bbscontent"><a href="/bbs/book_re.aspx?id=42&amp;tofloor=999">quoted link</a></div><a href="/bbs/book_re.aspx?id=99&amp;tofloor=888">other topic</a>',
      { id: '42' }
    );
    expect(authored.replyWatermark).toBeUndefined();
  });
  it('keeps external download blocks in document order without duplicating nested or main content', () => {
    const downloads = Array.from(
      { length: 64 },
      (_, index) => `<div><p>下载 ${index}<a href="https://pan.example.com/${index}">资源 ${index}</a></p></div>`
    ).join('');
    const detail = parseYaohuoTopicHtml(
      `<div><p>ancestor-only text</p><section><div class="bbscontent"><p>主楼下载</p></div></section></div>
       <section>${downloads}</section><div class="footer">下载 footer-only text</div>`,
      { id: '1' }
    );
    const content = parseHtml(detail.contentHtml);
    expect(content.querySelectorAll('a').map((link) => link.getAttribute('href'))).toEqual(
      Array.from({ length: 64 }, (_, index) => `https://pan.example.com/${index}`)
    );
    expect(detail.contentHtml.match(/主楼下载/g)).toHaveLength(1);
    expect(detail.contentHtml).not.toContain('ancestor-only text');
    expect(detail.contentHtml).not.toContain('footer-only text');
  });

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

  it.each([false, true])(
    'drops link-only duplicate blocks regardless of document order (link first: %s)',
    (linkFirst) => {
      const full = '<div>火友 (7) #71 阿根廷没问题。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>';
      const link = '<div>火友 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div>';
      const replies = parseUserReplies((linkFirst ? [link, full] : [full, link]).join(''), {
        id: '7',
        username: '火友'
      });

      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({
        floor: 71,
        excerpt: '阿根廷没问题。'
      });
    }
  );

  it.each([
    { label: 'short content', prefix: '' },
    { label: 'the same truncated excerpt', prefix: '相同的长正文前缀'.repeat(30) }
  ])('keeps distinct floorless replies in the same minute with $label', ({ prefix }) => {
    const rows = ['第一条说明', '第二条补充'].map(
      (content, index) =>
        `<div class="line${index + 1}">火友 (7) ${prefix}${content} 2026-09-20 10:30 <a href="/bbs-66.html">查看</a></div>`
    );
    const replies = parseUserReplies(rows.join(''), { id: '7', username: '火友' });
    expect(replies).toHaveLength(2);
    expect(new Set(replies.map((reply) => reply.id)).size).toBe(2);
    expect(replies.every((reply) => reply.excerpt && reply.createdAt && !reply.floor)).toBe(true);
    const reversed = parseUserReplies([...rows].reverse().join(''), { id: '7', username: '火友' });
    expect(reversed.map((reply) => reply.id)).toEqual(replies.map((reply) => reply.id).reverse());
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

  it('uses the current profile nickname for user identity and authored replies', () => {
    const profile = parseUserProfile(
      `
      <div class="uinfo-page"><div class="uinfo-profile"><div class="uinfo-nickname">火友</div></div>
        <div class="uinfo-stat posts"><div class="uinfo-stat-inner"><div class="uinfo-text">
          <div class="label">帖子</div><div class="value">3</div>
        </div></div></div>
        <div class="uinfo-stat replies"><div class="uinfo-stat-inner"><div class="uinfo-text">
          <div class="label">回复</div><div class="value">8</div>
        </div></div></div>
        <div class="uinfo-stat level"><div class="uinfo-stat-inner"><div class="uinfo-text">
          <div class="value">2<span class="unit">级</span></div><div class="label">等级</div>
        </div></div></div>
        <div class="uinfo-stat reg"><div class="uinfo-stat-inner"><div class="uinfo-text">
          <div class="value">1<span class="unit">年</span></div><div class="label">注册时长</div>
        </div></div></div>
      </div>
    `,
      { id: '7', username: '7' }
    );

    expect(profile).toMatchObject({
      id: '7',
      username: '火友',
      displayName: '火友',
      topicCount: 3,
      replyCount: 8,
      postCount: 11,
      levelLabel: '2级'
    });
    expect(sourceDiagnosticSummary(profile)).toMatchObject({ validCount: 1, isParseEmpty: false });
    const replies = parseUserReplies(
      '<div class="line1">火友 (7) #2 回帖正文 2026-10-09 12:00 <a href="/bbs-66.html">查看</a></div>',
      { id: profile.id, username: profile.displayName }
    );
    expect(replies[0]).toMatchObject({ author: '火友', excerpt: '回帖正文' });
  });
});
