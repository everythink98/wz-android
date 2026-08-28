import { describe, expect, it } from 'vitest';
import {
  buildNodeSeekAttendanceRequest,
  buildNodeSeekCollectionRequest,
  buildNodeSeekEditReplyRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekPollLockRequest,
  buildNodeSeekPollCreateRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekStardustPrepareRequest,
  buildNodeSeekStardustSendRequest,
  buildNodeSeekVoteRequest,
  nodeSeekActionErrorMessage
} from './actionRequest';

describe('NodeSeek action request builders', () => {
  it('builds a reply request with a csrf token and the expected payload', () => {
    const request = buildNodeSeekReplyRequest({
      postId: '723704',
      content: '  谢谢分享  ',
      csrfToken: 'fixed-csrf-token'
    });

    expect(request).toEqual({
      path: '/api/content/new-comment',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        referer: 'https://www.nodeseek.com/post-723704-1',
        'csrf-token': 'fixed-csrf-token'
      },
      body: JSON.stringify({
        content: '谢谢分享',
        mode: 'new-comment',
        postId: 723704
      })
    });
  });

  it('rejects empty reply content', () => {
    expect(() =>
      buildNodeSeekReplyRequest({
        postId: '723704',
        content: '   ',
        csrfToken: 'fixed-csrf-token'
      })
    ).toThrow('请输入回复内容');
  });

  it('generates a NodeSeek content request token when none is saved', () => {
    const replyRequest = buildNodeSeekReplyRequest({
      postId: '723704',
      content: '谢谢分享',
      csrfToken: ' '
    });

    const editRequest = buildNodeSeekEditReplyRequest({
      commentId: '812345',
      content: '更新后的内容',
      csrfToken: ''
    });

    expect(replyRequest.headers['csrf-token']).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(editRequest.headers['csrf-token']).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it('prefixes NodeSeek floor replies with the original floor reference', () => {
    const request = buildNodeSeekReplyRequest({
      postId: '723704',
      content: '  谢谢分享  ',
      csrfToken: 'fixed-csrf-token',
      replyTarget: {
        floor: 15,
        author: 'bob'
      }
    });

    expect(JSON.parse(request.body || '{}')).toMatchObject({
      content: '@bob [#15](https://www.nodeseek.com/post-723704-15)\n\n谢谢分享'
    });
  });

  it('builds upvote and like interaction requests for a comment', () => {
    expect(
      buildNodeSeekInteractionRequest({
        type: 'upvote',
        commentId: 812345
      })
    ).toEqual({
      path: '/api/statistics/upvote',
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        commentId: 812345,
        action: 'add'
      })
    });

    expect(
      buildNodeSeekInteractionRequest({
        type: 'like',
        commentId: 812345
      }).path
    ).toBe('/api/statistics/like');
  });

  it('builds dislike interaction requests for a comment', () => {
    expect(
      buildNodeSeekInteractionRequest({
        type: 'dislike',
        commentId: '812345'
      })
    ).toEqual({
      path: '/api/statistics/dislike',
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        commentId: 812345,
        action: 'add'
      })
    });
  });

  it('builds an edit request for an own NodeSeek comment', () => {
    expect(
      buildNodeSeekEditReplyRequest({
        commentId: '812345',
        content: '  更新后的内容  ',
        csrfToken: 'fixed-csrf-token'
      })
    ).toEqual({
      path: '/api/content/edit-comment',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'csrf-token': 'fixed-csrf-token'
      },
      body: JSON.stringify({
        commentId: 812345,
        content: '更新后的内容',
        mode: 'edit-comment'
      })
    });
  });

  it('rejects unsupported NodeSeek reaction removal requests', () => {
    expect(() =>
      buildNodeSeekInteractionRequest({
        type: 'dislike',
        commentId: '812345',
        active: true
      })
    ).toThrow('NodeSeek 原站不支持取消反对');

    expect(() =>
      buildNodeSeekInteractionRequest({
        type: 'like',
        commentId: '812345',
        active: true
      })
    ).toThrow('NodeSeek 原站不支持取消鸡腿');

    expect(() =>
      buildNodeSeekInteractionRequest({
        type: 'upvote',
        commentId: '812345',
        active: true
      })
    ).toThrow('NodeSeek 原站不支持取消点赞');
  });

  it('builds NodeSeek original collection toggle requests', () => {
    expect(
      buildNodeSeekCollectionRequest({
        postId: '723704',
        collected: true
      })
    ).toEqual({
      path: '/api/statistics/collection',
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        postId: 723704,
        action: 'remove'
      })
    });
  });

  it('builds an attendance request with the random option encoded in the URL', () => {
    expect(buildNodeSeekAttendanceRequest({ random: true })).toEqual({
      path: '/api/attendance?random=true',
      method: 'POST',
      headers: {},
      body: undefined
    });
  });

  it('builds a vote request with selected NodeSeek vote item ids', () => {
    expect(buildNodeSeekVoteRequest({ optionIds: ['71', 72] })).toEqual({
      path: '/api/vote/voteforitem',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dynamic-sign': 'a'.repeat(40)
      },
      body: JSON.stringify({
        ids: [71, 72]
      })
    });
  });

  it('builds poll creation without creating it during editor insertion', () => {
    expect(
      buildNodeSeekPollCreateRequest({
        poll: { title: '选择', multiple: true, isPublic: false, options: ['A', 'B'] }
      })
    ).toMatchObject({
      path: '/api/vote/info',
      method: 'POST',
      body: JSON.stringify({ title: '选择', multiple: true, isPublic: false, items: ['A', 'B'] })
    });
  });

  it('builds the owner-only NodeSeek poll lock request', () => {
    expect(buildNodeSeekPollLockRequest({ pollId: '3037' })).toEqual({
      path: '/api/vote/lock/3037',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dynamic-sign': 'a'.repeat(40)
      },
      body: JSON.stringify({ locked: true }),
      fallbackErrorMessage: '投票锁定失败'
    });
  });

  it('uses the real Stardust origin, onetime field, and error fallback', () => {
    expect(buildNodeSeekStardustPrepareRequest({ receiverId: '42' })).toEqual({
      path: '/api/stardust/payment-prepare',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receiver_id: 42, origin: 'https://www.nodeseek.com' }),
      fallbackErrorMessage: '获取支付基础信息失败'
    });
    expect(
      buildNodeSeekStardustSendRequest({
        receive: { receiverMemberId: '42', amount: 5, refId: 100, description: 'Pay', oneTime: true }
      })
    ).toEqual({
      path: '/api/stardust/send',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: 42, diff: 5, ref_id: 100, onetime: true }),
      fallbackErrorMessage: '转账失败'
    });
    expect(() =>
      buildNodeSeekStardustSendRequest({
        receive: { receiverMemberId: '42', amount: 5, refId: 99, description: '旧卡片', oneTime: false }
      })
    ).toThrow('Ref ID 必须为大于等于 100 的安全整数');
    expect(nodeSeekActionErrorMessage({ message: '余额不足' }, 400, '转账失败')).toBe('余额不足');
    expect(nodeSeekActionErrorMessage({}, 400, '转账失败')).toBe('转账失败');
  });

  it('rejects empty NodeSeek vote selections', () => {
    expect(() => buildNodeSeekVoteRequest({ optionIds: [] })).toThrow('请选择投票选项');
  });

  it('extracts a useful action error message without exposing raw internals', () => {
    expect(
      nodeSeekActionErrorMessage(
        {
          success: false,
          message: 'ALREADY CHECKED IN'
        },
        400
      )
    ).toBe('ALREADY CHECKED IN');

    expect(nodeSeekActionErrorMessage(null, 403)).toBe('NodeSeek 拒绝了请求，请稍后重试');
  });
});
