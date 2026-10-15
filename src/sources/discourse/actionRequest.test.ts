import { describe, expect, it } from 'vitest';

import {
  buildDiscourseActionRequest,
  discourseCreatedReplyTarget,
  discourseImageUrlFromUploadResponse
} from './actionRequest';

describe('Discourse action requests', () => {
  it('targets reactions and boosts by post ID without creating a reply', () => {
    expect(buildDiscourseActionRequest({ type: 'toggle-reaction', postId: 101, reactionId: '+1' })).toEqual({
      path: '/discourse-reactions/posts/101/custom-reactions/%2B1/toggle.json',
      method: 'PUT',
      headers: {}
    });
    const create = buildDiscourseActionRequest({ type: 'create-boost', postId: 101, content: ' 合影 :bili_057: ' });
    expect(create).toMatchObject({ path: '/discourse-boosts/posts/101/boosts.json', method: 'POST' });
    expect(new URLSearchParams(String(create.body)).get('raw')).toBe('合影 :bili_057:');
    expect(buildDiscourseActionRequest({ type: 'delete-boost', boostId: 51 })).toMatchObject({
      path: '/discourse-boosts/boosts/51.json',
      method: 'DELETE'
    });
    expect(() =>
      buildDiscourseActionRequest({ type: 'toggle-reaction', postId: 101, reactionId: '../heart' })
    ).toThrow();
    expect(() => buildDiscourseActionRequest({ type: 'create-boost', postId: 101, content: ' ' })).toThrow();
  });
  it('locates only a valid created post belonging to the submitted topic', () => {
    const post = { id: 121, post_number: 21, topic_id: 42 };
    expect(discourseCreatedReplyTarget(post, '42')).toEqual({ commentId: 121, floor: 21 });
    expect(discourseCreatedReplyTarget({ post }, '42')).toEqual({ commentId: 121, floor: 21 });
    for (const result of [
      null,
      {},
      { success: true },
      { action: 'enqueued', post },
      { success: false, post },
      { ...post, topic_id: 43 },
      { ...post, id: 0 },
      { ...post, id: '121' },
      { ...post, post_number: 1 },
      { ...post, post_number: 1.5 },
      { ...post, post_number: Number.MAX_SAFE_INTEGER + 1 }
    ]) {
      expect(discourseCreatedReplyTarget(result, '42')).toBeUndefined();
    }
  });
  it('builds an existing-topic reply without knowing the site', () => {
    const request = buildDiscourseActionRequest({
      type: 'reply',
      topicId: '42',
      content: '  hello forum  ',
      replyToPostNumber: 3
    });

    expect(request).toEqual({
      path: '/posts.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'topic_id=42&raw=hello+forum&reply_to_post_number=3'
    });
  });

  it('builds standard like and unlike requests', () => {
    expect(buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true })).toEqual({
      path: '/post_actions',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=101&post_action_type_id=2'
    });
    expect(buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: false })).toEqual({
      path: '/post_actions/101?post_action_type_id=2',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
  });

  it('builds edit and delete requests with shared validation', () => {
    expect(buildDiscourseActionRequest({ type: 'edit-post', postId: 1002, content: '  edited  ' })).toEqual({
      path: '/posts/1002.json',
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'post%5Braw%5D=edited'
    });
    expect(buildDiscourseActionRequest({ type: 'delete-post', postId: 1002 })).toEqual({
      path: '/posts/1002.json',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
    expect(() => buildDiscourseActionRequest({ type: 'delete-post', postId: 'bad' })).toThrow('回复 id 不正确');
  });

  it('builds standard bookmark and unbookmark requests', () => {
    expect(
      buildDiscourseActionRequest({
        type: 'set-bookmark',
        targetId: 42,
        targetType: 'Topic',
        active: true
      })
    ).toEqual({
      path: '/bookmarks.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'bookmarkable_id=42&bookmarkable_type=Topic'
    });
    expect(
      buildDiscourseActionRequest({
        type: 'set-bookmark',
        targetId: 42,
        targetType: 'Topic',
        active: false,
        bookmarkId: 900
      })
    ).toEqual({
      path: '/bookmarks/900.json',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
  });

  it('builds a standard poll vote request', () => {
    const request = buildDiscourseActionRequest({
      type: 'vote',
      postId: 1001,
      pollName: 'poll',
      optionIds: ['a1', 'b2']
    });
    const params = new URLSearchParams(String(request.body));

    expect(request).toMatchObject({
      path: '/polls/vote',
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    expect(params.get('post_id')).toBe('1001');
    expect(params.get('poll_name')).toBe('poll');
    expect(params.getAll('options[]')).toEqual(['a1', 'b2']);
  });

  it('builds uploads and resolves site-relative image URLs', () => {
    const request = buildDiscourseActionRequest({
      type: 'upload',
      file: {
        uri: 'file:///cache/demo.png',
        name: 'demo.png',
        mimeType: 'image/png'
      }
    });

    expect(request).toMatchObject({ path: '/uploads.json', method: 'POST', headers: {} });
    expect(request.body).toBeInstanceOf(FormData);
    expect(
      discourseImageUrlFromUploadResponse(
        { url: '/uploads/default/original/a.png' },
        'https://forum.example.com',
        '示例站'
      )
    ).toBe('https://forum.example.com/uploads/default/original/a.png');
  });
});
