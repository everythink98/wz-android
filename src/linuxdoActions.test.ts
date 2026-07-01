import { describe, expect, it } from 'vitest';

import {
  buildLinuxDoBookmarkRequest,
  buildLinuxDoDeleteReplyRequest,
  buildLinuxDoLikeRequest,
  buildLinuxDoPollVoteRequest,
  buildLinuxDoReplyRequest
} from './linuxdoActions';

describe('linux.do action requests', () => {
  it('builds a Discourse reply request without creating new topics', () => {
    const request = buildLinuxDoReplyRequest({
      topicId: '42',
      content: '  hello linux.do  ',
      replyToPostNumber: 3
    });

    expect(request).toMatchObject({
      path: '/posts.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    expect(String(request.body)).toContain('topic_id=42');
    expect(String(request.body)).toContain('raw=hello+linux.do');
    expect(String(request.body)).toContain('reply_to_post_number=3');
  });

  it('builds like and unlike requests for Discourse post actions', () => {
    expect(buildLinuxDoLikeRequest({ postId: 101, liked: false })).toEqual({
      path: '/post_actions',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=101&post_action_type_id=2'
    });

    expect(buildLinuxDoLikeRequest({ postId: 101, liked: true })).toEqual({
      path: '/post_actions/101?post_action_type_id=2',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
  });

  it('builds delete requests for own Discourse replies', () => {
    expect(buildLinuxDoDeleteReplyRequest({ postId: '1002' })).toEqual({
      path: '/posts/1002.json',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
    expect(() => buildLinuxDoDeleteReplyRequest({ postId: 'bad' })).toThrow('回复 id 不正确');
  });

  it('builds bookmark and unbookmark requests for topics', () => {
    expect(buildLinuxDoBookmarkRequest({
      bookmarkableId: '42',
      bookmarkableType: 'Topic',
      bookmarked: false
    })).toEqual({
      path: '/bookmarks.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'bookmarkable_id=42&bookmarkable_type=Topic'
    });

    expect(buildLinuxDoBookmarkRequest({
      bookmarkableId: '42',
      bookmarkableType: 'Topic',
      bookmarked: true,
      bookmarkId: 900
    })).toEqual({
      path: '/bookmarks/900.json',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
  });

  it('builds poll vote requests for Discourse polls', () => {
    const request = buildLinuxDoPollVoteRequest({
      postId: '1001',
      pollName: 'poll',
      optionIds: ['a1', 'b2']
    });
    const params = new URLSearchParams(String(request.body || ''));

    expect(request).toMatchObject({
      path: '/polls/vote',
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    expect(params.get('post_id')).toBe('1001');
    expect(params.get('poll_name')).toBe('poll');
    expect(params.getAll('options[]')).toEqual(['a1', 'b2']);
  });
});
