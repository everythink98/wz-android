import { describe, expect, it } from 'vitest';

import { buildDiscourseActionRequest, discourseImageUrlFromUploadResponse } from './discourseActions';

describe('Discourse action requests', () => {
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
    expect(buildDiscourseActionRequest({
      type: 'set-bookmark',
      targetId: 42,
      targetType: 'Topic',
      active: true
    })).toEqual({
      path: '/bookmarks.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'bookmarkable_id=42&bookmarkable_type=Topic'
    });
    expect(buildDiscourseActionRequest({
      type: 'set-bookmark',
      targetId: 42,
      targetType: 'Topic',
      active: false,
      bookmarkId: 900
    })).toEqual({
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
    expect(discourseImageUrlFromUploadResponse(
      { url: '/uploads/default/original/a.png' },
      'https://forum.example.com',
      '示例站'
    )).toBe('https://forum.example.com/uploads/default/original/a.png');
  });
});
