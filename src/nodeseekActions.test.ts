import { describe, expect, it } from 'vitest';
import {
  buildNodeSeekAttendanceRequest,
  buildNodeSeekCollectionRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekReplyRequest,
  buildNodeSeekVoteRequest,
  nodeSeekActionErrorMessage
} from './nodeseekActions';

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
    expect(() => buildNodeSeekReplyRequest({
      postId: '723704',
      content: '   ',
      csrfToken: 'fixed-csrf-token'
    })).toThrow('请输入回复内容');
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
    expect(buildNodeSeekInteractionRequest({
      type: 'upvote',
      commentId: 812345
    })).toEqual({
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

    expect(buildNodeSeekInteractionRequest({
      type: 'like',
      commentId: 812345
    }).path).toBe('/api/statistics/like');
  });

  it('builds dislike and remove interaction requests for a comment', () => {
    expect(buildNodeSeekInteractionRequest({
      type: 'dislike',
      commentId: '812345',
      active: true
    })).toEqual({
      path: '/api/statistics/dislike',
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        commentId: 812345,
        action: 'remove'
      })
    });
  });

  it('builds NodeSeek original collection toggle requests', () => {
    expect(buildNodeSeekCollectionRequest({
      postId: '723704',
      collected: true
    })).toEqual({
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
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        ids: [71, 72]
      })
    });
  });

  it('rejects empty NodeSeek vote selections', () => {
    expect(() => buildNodeSeekVoteRequest({ optionIds: [] })).toThrow('请选择投票选项');
  });

  it('extracts a useful action error message without exposing raw internals', () => {
    expect(nodeSeekActionErrorMessage({
      success: false,
      message: 'ALREADY CHECKED IN'
    }, 400)).toBe('ALREADY CHECKED IN');

    expect(nodeSeekActionErrorMessage(null, 403)).toBe('NodeSeek 拒绝了请求，请稍后重试');
  });
});
