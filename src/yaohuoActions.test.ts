import { describe, expect, it } from 'vitest';
import {
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid
} from './yaohuoActions';

function bodyParams(body?: string) {
  return new URLSearchParams(body || '');
}

describe('yaohuo action request builders', () => {
  it('extracts sidyaohuo from a saved cookie header', () => {
    expect(extractYaohuoSid('ASP.NET_SessionId=session; sidyaohuo=abc123; GUID=guid')).toBe('abc123');
    expect(extractYaohuoSid('GUID=guid')).toBe('');
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
    const params = bodyParams(buildYaohuoReplyRequest({
      topicId: '123',
      classId: '177',
      content: '回复楼层',
      replyFloor: 4,
      toUserId: '789',
      sid: 'abc123'
    }).body);

    expect(params.get('reply')).toBe('4');
    expect(params.get('touserid')).toBe('789');
    expect(params.get('g')).toBe('发表回复');
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

  it('builds yaohuo multi-choice vote requests with every selected option id', () => {
    expect(buildYaohuoVoteRequest({
      topicId: '123',
      classId: '177',
      voteIds: ['55', '56']
    })).toMatchObject({
      path: '/bbs/book_view_toVote.aspx?siteid=1000&classid=177&vid=55&vid=56&vpage=1&lpage=2&id=123',
      method: 'GET'
    });
  });

  it('rejects empty reply content and invalid ids', () => {
    expect(() => buildYaohuoReplyRequest({
      topicId: '123',
      classId: '177',
      content: '   '
    })).toThrow('请输入回复内容');

    expect(() => buildYaohuoVoteRequest({
      topicId: '123',
      classId: '177',
      voteId: 'bad'
    })).toThrow('投票 id 不正确');

    expect(() => buildYaohuoVoteRequest({
      topicId: '123',
      classId: '177',
      voteIds: []
    })).toThrow('请选择投票选项');
  });
});
