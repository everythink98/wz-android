import { describe, expect, it, vi } from 'vitest';
import {
  buildYaohuoDeleteFavoriteRequest,
  buildYaohuoDeleteReplyRequest,
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid
} from './yaohuoActions';

function bodyParams(body?: string) {
  return new URLSearchParams(body || '');
}

describe('yaohuo action request builders', () => {
  it('[REG-ACCOUNT-036] extracts exactly one active sidyaohuo from duplicate Cookie scopes', () => {
    expect(extractYaohuoSid('ASP.NET_SessionId=session; sidyaohuo=abc123; GUID=guid')).toBe('abc123');
    expect(extractYaohuoSid('sidyaohuo=-2; SIDYAOHUO=abc123; sidyaohuo=abc123')).toBe('abc123');
    expect(extractYaohuoSid('sidyaohuo= ; sidyaohuo=-2; GUID=guid')).toBe('');
  });

  it('[REG-ACCOUNT-036] refuses conflicting active sidyaohuo values before reply or delete transport', () => {
    const cookieHeader = 'sidyaohuo=first-session; SIDYAOHUO=second-session';
    const transport = vi.fn();
    const submitReply = () =>
      transport(
        buildYaohuoReplyRequest({
          topicId: '123',
          classId: '177',
          content: '正文',
          sid: extractYaohuoSid(cookieHeader)
        })
      );
    const submitDelete = () =>
      transport(
        buildYaohuoDeleteReplyRequest({
          deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&lpage=1&page=1&reid=17080475&id=798458',
          sid: extractYaohuoSid(cookieHeader)
        })
      );

    expect(submitReply).toThrow('妖火登录状态存在冲突，请重新检测登录状态');
    expect(submitDelete).toThrow('妖火登录状态存在冲突，请重新检测登录状态');
    expect(transport).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-036] propagates the unique active sid to reply body and delete URL', () => {
    const sid = extractYaohuoSid('sidyaohuo=-2; SIDYAOHUO=active-session');
    const reply = buildYaohuoReplyRequest({
      topicId: '123',
      classId: '177',
      content: '正文',
      sid
    });
    const deletion = buildYaohuoDeleteReplyRequest({
      deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&lpage=1&page=1&reid=17080475&id=798458',
      sid
    });

    expect(bodyParams(reply.body).get('sid')).toBe('active-session');
    expect(new URLSearchParams(deletion.path.split('?')[1] || '').get('sid')).toBe('active-session');
  });

  it('builds a topic reply request using yaohuo form fields', () => {
    const request = buildYaohuoReplyRequest({
      topicId: '123',
      classId: '177',
      content: '  第一行\n第二行  ',
      sid: 'abc123'
    });
    const params = bodyParams(request.body);

    expect(request).toMatchObject({
      path: '/bbs/book_re.aspx',
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    });
    expect(params.get('content')).toBe('第一行\r\n第二行');
    expect(params.get('sendmsg')).toBe('0');
    expect(params.get('action')).toBe('add');
    expect(params.get('id')).toBe('123');
    expect(params.get('classid')).toBe('177');
    expect(params.get('siteid')).toBe('1000');
    expect(params.get('lpage')).toBe('1');
    expect(params.get('sid')).toBe('abc123');
    expect(params.get('g')).toBe('快速回复');
  });

  it('builds a floor reply request with reply floor and target user id', () => {
    const params = bodyParams(
      buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '回复楼层',
        replyFloor: 4,
        toUserId: '789',
        sid: 'abc123'
      }).body
    );

    expect(params.get('reply')).toBe('4');
    expect(params.get('touserid')).toBe('789');
    expect(params.get('g')).toBe('发表回复');
  });

  it('keeps yaohuo face as a separate reply field', () => {
    const params = bodyParams(
      buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '正文',
        face: '淡定.gif'
      }).body
    );

    expect(params.get('content')).toBe('正文');
    expect(params.get('face')).toBe('淡定.gif');
  });

  it('builds original favorite and vote requests', () => {
    expect(buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' })).toMatchObject({
      path: '/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=123',
      method: 'GET'
    });

    expect(buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '55' })).toMatchObject({
      path: '/bbs/book_view_toVote.aspx?siteid=1000&classid=177&vid=55&vpage=1&lpage=2&id=123',
      method: 'GET'
    });
  });

  it('REG-WRITE-003 builds the original favorite-record delete request', () => {
    expect(buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' })).toEqual({
      path: '/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987',
      method: 'POST',
      headers: { accept: '*/*' }
    });
  });

  it('builds yaohuo multi-choice vote requests with every selected option id', () => {
    expect(
      buildYaohuoVoteRequest({
        topicId: '123',
        classId: '177',
        voteIds: ['55', '56']
      })
    ).toMatchObject({
      path: '/bbs/book_view_toVote.aspx?siteid=1000&classid=177&vid=55&vid=56&vpage=1&lpage=2&id=123',
      method: 'GET'
    });
  });

  it('builds a yaohuo own-reply delete request from the original delete link', () => {
    const request = buildYaohuoDeleteReplyRequest({
      deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&lpage=1&page=1&reid=17080475&id=798458',
      sid: 'abc123'
    });

    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({});
    expect(request.path.startsWith('/bbs/Book_re_del.aspx?')).toBe(true);
    const params = new URLSearchParams(request.path.split('?')[1] || '');
    expect(params.get('action')).toBe('go');
    expect(params.get('siteid')).toBe('1000');
    expect(params.get('classid')).toBe('177');
    expect(params.get('reid')).toBe('17080475');
    expect(params.get('id')).toBe('798458');
    expect(params.get('sid')).toBe('abc123');
  });

  it('rejects yaohuo reply delete links outside yaohuo or without required ids', () => {
    expect(() =>
      buildYaohuoDeleteReplyRequest({
        deletePath: 'https://evil.example/bbs/Book_re_del.aspx?action=go&classid=177&reid=17080475&id=798458'
      })
    ).toThrow('妖火删除链接不正确');

    expect(() =>
      buildYaohuoDeleteReplyRequest({
        deletePath: '/bbs/Book_re_del.aspx?action=go&classid=177&id=798458'
      })
    ).toThrow('回复 id 不正确');
  });

  it('rejects empty reply content and invalid ids', () => {
    expect(() =>
      buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '   '
      })
    ).toThrow('请输入回复内容');

    expect(() =>
      buildYaohuoVoteRequest({
        topicId: '123',
        classId: '177',
        voteId: 'bad'
      })
    ).toThrow('投票 id 不正确');

    expect(() =>
      buildYaohuoVoteRequest({
        topicId: '123',
        classId: '177',
        voteIds: []
      })
    ).toThrow('请选择投票选项');
  });
});
