import { describe, expect, it } from 'vitest';

import {
  buildXiaoyinsiBookmarkRequest,
  buildXiaoyinsiDeleteReplyRequest,
  buildXiaoyinsiEditReplyRequest,
  buildXiaoyinsiImageUploadRequest,
  buildXiaoyinsiLikeRequest,
  buildXiaoyinsiPollVoteRequest,
  buildXiaoyinsiReplyRequest,
  xiaoyinsiImageUrlFromUploadResponse
} from './xiaoyinsiActions';

describe('小隐寺 action requests', () => {
  it('只构造回复与楼层回复，不创建新主题', () => {
    const request = buildXiaoyinsiReplyRequest({
      topicId: '42',
      content: '  hello 小隐寺  ',
      replyToPostNumber: 3
    });

    expect(request).toMatchObject({
      path: '/posts.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    const params = new URLSearchParams(String(request.body));
    expect(params.get('topic_id')).toBe('42');
    expect(params.get('raw')).toBe('hello 小隐寺');
    expect(params.get('reply_to_post_number')).toBe('3');
  });

  it('构造编辑和删除请求并拒绝无效 id', () => {
    expect(buildXiaoyinsiEditReplyRequest({ postId: 1002, content: '  edited  ' })).toEqual({
      path: '/posts/1002.json',
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'post%5Braw%5D=edited'
    });
    expect(buildXiaoyinsiDeleteReplyRequest({ postId: 1002 })).toEqual({
      path: '/posts/1002.json',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
    expect(() => buildXiaoyinsiDeleteReplyRequest({ postId: 'bad' })).toThrow('回复 id 不正确');
  });

  it('[REG-XIAOYINSI-003] 构造点赞、无 bookmark id 取消书签和 Poll 请求', () => {
    expect(buildXiaoyinsiLikeRequest({ postId: 101, liked: false })).toEqual({
      path: '/post_actions',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=101&post_action_type_id=2'
    });
    expect(buildXiaoyinsiLikeRequest({ postId: 101, liked: true })).toEqual({
      path: '/post_actions/101?post_action_type_id=2',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
    expect(buildXiaoyinsiBookmarkRequest({
      bookmarkableId: 42,
      bookmarkableType: 'Topic',
      bookmarked: false
    })).toEqual({
      path: '/bookmarks.json',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'bookmarkable_id=42&bookmarkable_type=Topic'
    });
    expect(buildXiaoyinsiBookmarkRequest({
      bookmarkableId: 42,
      bookmarkableType: 'Topic',
      bookmarked: true
    })).toEqual({
      path: '/t/42/remove_bookmarks',
      method: 'PUT',
      headers: {},
      body: undefined
    });

    const pollRequest = buildXiaoyinsiPollVoteRequest({
      postId: 1001,
      pollName: 'poll',
      optionIds: ['a1', 'b2']
    });
    const pollParams = new URLSearchParams(String(pollRequest.body));
    expect(pollRequest.path).toBe('/polls/vote');
    expect(pollParams.getAll('options[]')).toEqual(['a1', 'b2']);
  });

  it('构造 Discourse 图片上传并从服务端结果读取图片地址', () => {
    const request = buildXiaoyinsiImageUploadRequest({
      file: {
        uri: 'file:///cache/demo.png',
        name: 'demo.png',
        mimeType: 'image/png'
      }
    });

    expect(request).toMatchObject({ path: '/uploads.json', method: 'POST', headers: {} });
    expect(request.body).toBeInstanceOf(FormData);
    expect(xiaoyinsiImageUrlFromUploadResponse({ short_url: 'upload://abc.png' })).toBe('upload://abc.png');
    expect(xiaoyinsiImageUrlFromUploadResponse({ url: '/uploads/default/original/a.png' }))
      .toBe('https://forum.xiaoyinsi.com/uploads/default/original/a.png');
  });
});
