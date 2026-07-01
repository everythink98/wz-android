import { describe, expect, it } from 'vitest';

import { parseYaohuoRepliesHtml } from './localYaohuo';

describe('yaohuo reply parsing', () => {
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
    `, { url: 'https://yaohuo.me/bbs-798458.html' });

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
});
