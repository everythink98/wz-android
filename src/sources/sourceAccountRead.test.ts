import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getCurrentUserProfile } from './sourceRead';

describe('source account read', () => {
  it('reads all three current identities only from their proven session seams', async () => {
    const nodeSeekCurrentUserPayload = Buffer.from(
      JSON.stringify({
        user: {
          member_id: 48872,
          member_name: '我是ikun',
          avatar: '/avatar/48872.png'
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`<script id="temp-script">${nodeSeekCurrentUserPayload}</script>`);
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(
          JSON.stringify({
            current_user: {
              username: 'alice',
              name: 'Alice',
              avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png',
              trust_level: 2
            }
          })
        );
      }
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(`
          <div class="top2">
            <a href="/myfile.aspx">我的地盘</a>
            <a href="/bbs/userinfo.aspx?touserid=7">空间</a>
            <a href="/bbs/book_list_search.aspx">帖子</a>
            <a href="/bbs/messagelist.aspx">信箱</a>
          </div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response('<div class="content">昵称:火友<br/>贴子(0).回复(0)</div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekAuthenticated: true });
    const linuxdo = await getCurrentUserProfile({
      source: 'linuxdo',
      fetcher,
      discourseAuth: { linuxdo: { authenticated: true } }
    });
    const yaohuo = await getCurrentUserProfile({ source: 'yaohuo', fetcher });

    expect(nodeseek).toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '我是ikun',
      url: 'https://www.nodeseek.com/space/48872',
      topics: []
    });
    expect(linuxdo).toMatchObject({
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      levelLabel: 'Lv2',
      topics: []
    });
    expect(yaohuo).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
      topics: []
    });
    expect(() => getCurrentUserProfile({ source: 'v2ex', fetcher })).toThrow('V2EX 不支持当前登录身份读取');
  });

  it('classifies the documented anonymous linux.do current-session 404 as an expired login', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html>login required</html>', {
          status: 404,
          headers: { 'content-type': 'text/html' }
        })
    );

    await expect(
      getCurrentUserProfile({
        source: 'linuxdo',
        fetcher,
        discourseAuth: { linuxdo: { authenticated: true } }
      })
    ).rejects.toMatchObject({
      source: 'linuxdo',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    });
  });

  it('treats an explicit anonymous linux.do current-session body as logged out', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ current_user: null }), {
          headers: { 'content-type': 'application/json' }
        })
    );

    await expect(
      getCurrentUserProfile({
        source: 'linuxdo',
        fetcher,
        discourseAuth: { linuxdo: { authenticated: true } }
      })
    ).rejects.toMatchObject({
      source: 'linuxdo',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    });
  });

  it('keeps a malformed successful linux.do current-session body unknown', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ csrf: 'present-without-user' }), {
          headers: { 'content-type': 'application/json' }
        })
    );
    const failure = await getCurrentUserProfile({
      source: 'linuxdo',
      fetcher,
      discourseAuth: { linuxdo: { authenticated: true } }
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({
      loginRequired: true,
      verificationRequired: true
    });
  });

  it.each([401, 403, 429])('keeps non-contract linux.do current-session HTTP %s unknown', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html>request rejected</html>', {
          status,
          headers: { 'content-type': 'text/html' }
        })
    );
    let failure: unknown;

    try {
      await getCurrentUserProfile({
        source: 'linuxdo',
        fetcher,
        discourseAuth: { linuxdo: { authenticated: true } }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
  });

  it('does not use a public NodeSeek profile as current-session proof', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/' || input === 'https://www.nodeseek.com/setting') {
        return new Response('<div>NodeSeek</div>');
      }
      if (input === 'https://www.nodeseek.com/api/account/getInfo/15105?readme=1') {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '备用用户', member_id: 15105 } }));
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekAuthenticated: true })).rejects.toThrow(
      '无法读取当前 NodeSeek 用户身份'
    );
    expect(fetcher).not.toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/account/getInfo/15105?readme=1',
      expect.anything()
    );
  });

  it('does not treat unrelated embedded profile data as the current NodeSeek account', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: { postId: 123 },
        profile: {
          member_id: 15105,
          member_name: '公开资料用户'
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/' || input === 'https://www.nodeseek.com/setting') {
        return new Response(`<script id="temp-script">${payload}</script>`);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
  });

  it('classifies an explicit NodeSeek guest page as an expired login', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/' || input === 'https://www.nodeseek.com/setting') {
        return new Response(
          '<a class="Username" href="/space/48872">旧账号</a><a class="btn" href="/signIn.html">登录</a><a class="btn" href="/register.html">注册</a>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).rejects.toMatchObject({
      source: 'nodeseek',
      loginRequired: true,
      reason: 'expired'
    });
  });

  it('reads the current NodeSeek identity from the current page without probing a user-id profile route', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        user: {
          member_id: 48872,
          member_name: '当前账号',
          avatar: '/avatar/48872.png'
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`<script id="temp-script">${payload}</script>`);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).resolves.toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '当前账号'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/', expect.anything());
  });

  it('keeps the proven NodeSeek current user when guest controls coexist in the document', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        user: {
          member_id: 48872,
          member_name: '当前账号',
          avatar: '/avatar/48872.png'
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`
          <script id="temp-script">${payload}</script>
          <a class="btn" href="/signIn.html">登录</a>
          <a class="btn" href="/register.html">注册</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).resolves.toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '当前账号'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps ambiguous NodeSeek page text as an ordinary identity failure', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/' || input === 'https://www.nodeseek.com/setting') {
        return new Response('<article>登录</article>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
  });

  it('keeps ordinary content with exact NodeSeek login links unknown', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response(
          '<article><a href="/signIn.html">登录教程</a><a href="/register.html">注册教程</a></article>'
        );
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>设置页面暂时无法读取</main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
  });

  it.each([403, 404])(
    'keeps the NodeSeek account probe HTTP %i unknown without consulting a guest fallback page',
    async (status) => {
      const fetcher = vi.fn(async (input: string) => {
        if (input === 'https://www.nodeseek.com/') {
          return new Response('', { status });
        }
        if (input === 'https://www.nodeseek.com/setting') {
          return new Response('<header><a href="/signIn.html">登录</a><a href="/register.html">注册</a></header>');
        }
        throw new Error(`unexpected ${input}`);
      });
      let failure: unknown;

      try {
        await getCurrentUserProfile({
          source: 'nodeseek',
          fetcher,
          nodeSeekAuthenticated: true
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toMatchObject({ loginRequired: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('reads the current NodeSeek account from settings when the home page has no user link', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response('<div>NodeSeek</div>');
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>UID: 15105 <a href="/space/15105">新账号</a></main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekAuthenticated: true })
    ).resolves.toMatchObject({
      source: 'nodeseek',
      id: '15105',
      username: '新账号',
      topics: []
    });
  });

  it('does not read the current NodeSeek account from sign-out-adjacent post author links', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`
          <a href="/space/4706">帖子作者</a>
          <a href="/setting"></a>
          <a href="/api/account/signOut"></a>
        `);
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>设置页面</main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekAuthenticated: true })).rejects.toThrow(
      '无法读取当前 NodeSeek 用户身份'
    );
  });

  it('does not use UID text beside a homepage author link as current-session proof', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/') {
        return new Response('<article>如何查看 UID: 4706</article><a href="/space/4706">帖子作者</a>');
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>设置页面</main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'nodeseek',
        fetcher,
        nodeSeekAuthenticated: true
      })
    ).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
  });

  it('reads the current yaohuo account name from the signed-in user topic list when the profile only exposes an id', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=45245">空间</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=45245&siteid=1000') {
        return new Response(`
          <div class="content">用户:45245人气值1空间人气1今日人气留言板</div>
          <div class="content">
            <a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub">贴子(1)</a>
            <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=45245">回复(1)</a>
          </div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub') {
        return new Response(
          '<div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=177&id=1">主题</a>/流金岁月/阅1/2026-05-20 10:00</div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=45245') {
        return new Response('<div>45245 #71 阿根廷没问题。 2026-07-03 13:45 <a href="/bbs-66.html">查看</a></div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'yaohuo', fetcher })).resolves.toMatchObject({
      source: 'yaohuo',
      id: '45245',
      username: '流金岁月',
      displayName: '流金岁月',
      topics: [],
      replies: [
        {
          author: '流金岁月',
          authorId: '45245',
          floor: 71,
          excerpt: '阿根廷没问题。',
          displayTimeText: '2026-07-03 13:45'
        }
      ]
    });
  });

  it('preserves a proven Yaohuo identity when optional profile enrichment fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response('temporarily unavailable', { status: 503 });
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'yaohuo',
        fetcher
      })
    ).resolves.toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      topics: []
    });
  });

  it('uses the canonical Yaohuo login-form protocol for current-user reads', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="listdata"><a href="/bbs-123.html">公开主题</a></div>');
      }
      if (input === 'https://www.yaohuo.me/waplogin.aspx?siteid=1000') {
        return new Response(`
          <script src="/NetCSS/CSS/Login/Gocaptcha/gocaptcha.global.js"></script>
          <form name="login" method="post">
            <input id="logname" name="logname" />
            <input id="password" name="logpass" type="password" />
          </form>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getCurrentUserProfile({
        source: 'yaohuo',
        fetcher
      })
    ).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://www.yaohuo.me/wapindex.aspx?sid=-2',
      'https://www.yaohuo.me/waplogin.aspx?siteid=1000'
    ]);
  });
});
